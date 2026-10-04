// Renders the closing card and appends it to the recorded demo.
const puppeteer = require("puppeteer-core");
const ffmpegPath = require("ffmpeg-static");
const path = require("path");
const { execFileSync } = require("child_process");
const dir = __dirname, main = path.join(dir, "rentcheck-demo.mp4"), png = path.join(dir, "end.png"), out = path.join(dir, "rentcheck-demo-final.mp4");

(async () => {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setContent(`<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
    <body style="margin:0;height:100vh;background:#0E1512;color:#F1F4F2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;font-family:Geist,system-ui,sans-serif">
    <div style="font:500 22px 'Geist Mono',monospace;color:#34D399;letter-spacing:.1em">RENTCHECK</div>
    <h1 style="font-size:92px;font-weight:600;letter-spacing:-.04em;margin:0;text-align:center;max-width:1500px;line-height:1.05">Know the rent. Spot the risk. <span style="color:#8B938F">Rent smarter.</span></h1>
    <p style="font-size:34px;color:#9AA29D;margin:0">Official RTB data · Garda warning signs · explainable answers</p></body>`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: png });
  await browser.close();
  execFileSync(ffmpegPath, ["-y", "-i", main, "-loop", "1", "-t", "4", "-i", png, "-filter_complex",
    "[0:v]fps=30,format=yuv420p[a];[1:v]fps=30,format=yuv420p,fade=t=in:st=0:d=0.5[b];[a][b]concat=n=2:v=1:a=0[v]",
    "-map", "[v]", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "ignore" });
  console.log("wrote", out);
})().catch(e => { console.error(e); process.exit(1); });
