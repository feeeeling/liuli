/** Consume POST SSE, including events split across UTF-8/network boundaries. */
async function consumeSSE(response, onEvent) {
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      message = JSON.parse(body).error || body;
    } catch {}
    throw new Error(message || `HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let event = "message";
  let data = [];
  let completed = false;
  const dispatch = () => {
    if (!data.length) return;
    const payload = JSON.parse(data.join("\n"));
    onEvent({ event, data: payload });
    if (event === "error") throw new Error(payload.message || "请求失败");
    if (event === "done") completed = true;
    data = [];
    event = "message";
  };
  const line = (value) => {
    value = value.replace(/\r$/, "");
    if (!value) dispatch();
    else if (value.startsWith("event:")) event = value.slice(6).trim();
    else if (value.startsWith("data:"))
      data.push(value.slice(5).replace(/^ /, ""));
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let end;
      while ((end = pending.indexOf("\n")) !== -1) {
        line(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
      if (done) break;
    }
    if (pending) line(pending);
    dispatch();
    if (!completed) throw new Error("连接已中断，请重试");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

module.exports = { consumeSSE };
