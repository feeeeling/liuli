const { app, nativeImage } = require("electron");
const fs = require("node:fs");

app
  .whenReady()
  .then(() => {
    const png = nativeImage
      .createFromPath(process.argv[2])
      .resize({ width: 256, height: 256 })
      .toPNG();
    if (!png.length) throw new Error("Unable to read Liuli icon");
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2); // ICO
    header.writeUInt16LE(1, 4); // one image, 0x0 denotes 256x256
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(header.length, 18);
    fs.writeFileSync(process.argv[3], Buffer.concat([header, png]));
    app.exit(0);
  })
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
