const url = process.argv[2] ?? "https://cdn1.ozone.ru/s3/multimedia-1-8/11030359436.jpg";
const variants = [
  url,
  url.replace(/multimedia-1-[a-z0-9]+\//i, "multimedia-1-f/"),
  url.replace(/multimedia-1-[a-z0-9]+\//i, "multimedia-1-wc/"),
  url.replace(/multimedia-1-[a-z0-9]+\//i, "multimedia-1-c/"),
  url.replace(/multimedia-1-[a-z0-9]+\//i, "multimedia-1-s/")
];

for (const u of variants) {
  try {
    const r = await fetch(u, {
      headers: { Referer: "https://www.ozon.ru/", "User-Agent": "Mozilla/5.0" }
    });
    const b = Buffer.from(await r.arrayBuffer());
    console.log(r.status, b.length, u);
  } catch (e) {
    console.log("err", u, e.message);
  }
}
