const fs = require("node:fs");
function writeIcon(source, target) {
    const png = fs.readFileSync(source);
    if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      throw new Error("Liuli icon must be a PNG");
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (width < 1 || height < 1 || width > 256 || height > 256) throw new Error("ICO source must be at most 256x256");
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2); // ICO
    header.writeUInt16LE(1, 4); // one PNG image; zero denotes 256px
    header.writeUInt8(width % 256, 6);
    header.writeUInt8(height % 256, 7);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(header.length, 18);
    fs.writeFileSync(target, Buffer.concat([header, png]));
}
if (require.main === module) {
  try { writeIcon(process.argv[2], process.argv[3]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { writeIcon };
