const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { _electron: electron } = require('playwright');
const { expect } = require('playwright/test');
const { closeElectron } = require('./electron-test.cjs');
const desktop = path.resolve(__dirname, '..');
const delay = ms => new Promise(r => setTimeout(r, ms));
const wait = async (fn, message) => { for (let i=0;i<150;i++) { if (await fn()) return; await delay(100); } throw new Error(message); };
test('Native clipboard events, encryption, search, formats, pause and persistence', {timeout:120000}, async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(),'liuli-clipboard-'));
  const profile=path.join(home,'profile'),agent=path.join(home,'agent');
  await fs.mkdir(profile);await fs.mkdir(agent);
  await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({clipboardEnabled:true,shortcuts:{input:'Control+Alt+F11',clipboard:'Control+Alt+F12',screenshot:'Control+Alt+F1',ocr:'Control+Alt+F2',latex:'Control+Alt+F3',silent:'Control+Alt+F4',clipboardHistory:'Control+Alt+F5'}}));
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PROXY|ELECTRON_RUN_AS_NODE|LIULI_CLIPBOARD_MONITOR/i.test(key)));
  Object.assign(env,{LIULI_USER_DATA_DIR:profile,PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1',LIULI_PROXY_PORTS:'0'});
  let application;
  t.after(async()=>{if(application)await closeElectron(application);await fs.rm(home,{recursive:true,force:true});});
  const launch=async()=>{
    application=await electron.launch({...(process.env.LIULI_E2E_EXECUTABLE?{executablePath:process.env.LIULI_E2E_EXECUTABLE,args:[]}:{args:[desktop]}),env,cwd:desktop,timeout:30000});
    await application.firstWindow();
    const status=await application.evaluate(async({app})=>{const m=process.mainModule.require(app.getAppPath()+'/main.cjs');await m.clipboardHistory.ready;return m.clipboardHistory.status;});
    assert.equal(status.available,true,JSON.stringify(status));assert.equal(status.recording,true);
  };
  const query=q=>application.evaluate(async({app},value)=>process.mainModule.require(app.getAppPath()+'/main.cjs').clipboardHistory.request('query',value),q);
  const writeText=value=>application.evaluate(async({clipboard},text)=>clipboard.writeText(text),value);
  const show=async()=>{
    await application.evaluate(async({app})=>process.mainModule.require(app.getAppPath()+'/main.cjs').clipboardUI.show());
    await wait(()=>Promise.resolve(application.windows().some(w=>w.url().endsWith('/clipboard.html'))),'popup missing');
    return application.windows().find(w=>w.url().endsWith('/clipboard.html'));
  };
  await launch();assert.equal((await query('')).total,0,'startup must not read existing clipboard');
  await writeText('琉璃 Alpha 可搜索 😀');
  await wait(async()=>(await query('alpha 可搜索')).total===1,'native text event missing');
  await application.evaluate(async({clipboard,ClipboardItem})=>clipboard.write([new ClipboardItem({'text/plain':new Blob(['富文本 Beta'],{type:'text/plain'}),'text/html':new Blob(['<b>富文本 Beta</b>'],{type:'text/html'})})]));
  await wait(async()=>(await query('beta')).total===1,'HTML event missing');
  let page=await show();
  const settingsPage=application.windows().find(w=>w.url().endsWith('/settings.html'));
  assert.equal(await application.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Alt+F5')),true);
  for(const theme of ['dark','light']) {
    await settingsPage.evaluate(value=>window.liuli.savePreferences({theme:value}),theme);
    await expect(page.locator('html')).toHaveAttribute('data-appearance',theme);
    if(process.env.LIULI_CLIPBOARD_QA_DIR){await fs.mkdir(process.env.LIULI_CLIPBOARD_QA_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.LIULI_CLIPBOARD_QA_DIR,`clipboard-${theme}.png`)});}
  }
  await page.locator('#search').fill('ALPHA 可搜索');await expect(page.locator('.entry')).toHaveCount(1);
  assert.equal(await page.locator('.entry').count(),1);assert.match(await page.locator('.entry').innerText(),/Alpha/);
  assert.ok(await application.evaluate(({app})=>process.mainModule.require(app.getAppPath()+'/main.cjs').clipboardUI.window.getBounds().height<=260),'short result list should remain compact');
  await page.locator('#search').press('Enter');await wait(()=>application.evaluate(({app})=>!process.mainModule.require(app.getAppPath()+'/main.cjs').clipboardUI.window.isVisible()),'popup not closed');await wait(async()=>await application.evaluate(({clipboard})=>clipboard.readText())==='琉璃 Alpha 可搜索 😀','use did not copy');
  assert.equal((await query('')).total,2,'selection should deduplicate');
  page=await show();await page.locator('#search').fill('beta');await expect(page.locator('.entry')).toHaveCount(1);await page.locator('#search').press('Enter');await wait(()=>application.evaluate(({app})=>!process.mainModule.require(app.getAppPath()+'/main.cjs').clipboardUI.window.isVisible()),'popup not closed');
  const rich=await application.evaluate(async({clipboard})=>{for(const item of await clipboard.read())if(item.types.includes('text/html'))return(await item.getType('text/html')).text();});assert.match(rich,/<b>富文本 Beta<\/b>/);
  await application.evaluate(async({clipboard,nativeImage,ClipboardItem},file)=>{const png=nativeImage.createFromPath(file);if(png.isEmpty())throw Error('fixture PNG invalid');await clipboard.write([new ClipboardItem({'image/png':new Blob([png.toPNG()],{type:'image/png'})})]);},path.resolve(desktop,'../docs/assets/icon.png'));
  await wait(async()=>(await query('image')).total===1,'native image event missing');
  page=await show();await page.locator('#search').fill('图片');await page.locator('.entry img').waitFor();await page.locator('#search').press('Enter');await wait(()=>application.evaluate(({app})=>!process.mainModule.require(app.getAppPath()+'/main.cjs').clipboardUI.window.isVisible()),'popup not closed');
  assert.equal(await application.evaluate(async({clipboard})=>(await clipboard.read()).some(item=>item.types.includes('image/png'))),true);
  for (const [format,value] of [['ExcludeClipboardContentFromMonitorProcessing',[0]],['CanIncludeInClipboardHistory',[0,0,0,0]]]) {
    await application.evaluate(async({clipboard,ClipboardItem},{format,value})=>clipboard.write([new ClipboardItem({'text/plain':new Blob(['EXCLUDED_SENTINEL'],{type:'text/plain'}),[`electron application/osclipboard;format="${format}"`]:new Blob([new Uint8Array(value)])})]),{format,value});
    await delay(200);assert.equal((await query('EXCLUDED_SENTINEL')).total,0,'Windows exclusion flag ignored');
  }
  page=await show();await page.locator('#pause').click();await wait(async()=>!(await query('')).status.recording,'pause failed');
  await writeText('PAUSED_SENTINEL');await delay(250);assert.equal((await query('PAUSED_SENTINEL')).total,0);
  await page.locator('#pause').click();await wait(async()=>(await query('')).status.recording,'resume failed');assert.equal((await query('PAUSED_SENTINEL')).total,0,'resume must not backfill');
  await writeText('持久化 Persist sentinel');await wait(async()=>(await query('persist')).total===1,'resume event missing');
  await assert.rejects(application.windows().find(w=>w.url().endsWith('/settings.html')).evaluate(()=>window.liuli.clipboardQuery('')),/Invalid sender/);
  await page.locator('#close').click();
  const folder=path.join(profile,'clipboard-history');const files=await fs.readdir(folder);assert.ok(files.includes('key.dat'));assert.ok(files.includes('history.idx'));
  for(const file of files){const bytes=await fs.readFile(path.join(folder,file));assert.equal(bytes.includes(Buffer.from('持久化')),false);assert.equal(bytes.includes(Buffer.from('Persist sentinel')),false);}
  assert.equal(await closeElectron(application),true,'clipboard worker should stop gracefully');application=undefined;await launch();assert.equal((await query('persist')).total,1);
  page=await show();await page.locator('#search').fill('persist');await expect(page.locator('.entry')).toHaveCount(1);await page.locator('#search').press('Control+Delete');await wait(async()=>(await query('persist')).total===0,'delete failed');
  await page.locator('#settings').click();const settings=application.windows().find(w=>w.url().endsWith('/settings.html'));await settings.locator('#clipboard-settings').waitFor({state:'visible'});
  await settings.locator('#clipboard-limit').selectOption('100');await wait(async()=>(await query('')).status.limit===100,'retention setting failed');
  await settings.locator('#clear-clipboard').click();await wait(async()=>(await query('')).total===0,'clear failed');assert.equal((await fs.readdir(folder)).filter(f=>f.endsWith('.bin')).length,0);
});

