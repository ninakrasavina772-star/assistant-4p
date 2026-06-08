import sharp from "sharp";

const url = process.argv[2] ?? "https://cdn1.ozone.ru/s3/multimedia-1-8/11030359436.jpg";
const res = await fetch(url, {
  headers: { Referer: "https://www.ozon.ru/", "User-Agent": "Mozilla/5.0" }
});
const buf = Buffer.from(await res.arrayBuffer());
const meta = await sharp(buf).metadata();
console.log({ bytes: buf.length, width: meta.width, height: meta.height, format: meta.format });
