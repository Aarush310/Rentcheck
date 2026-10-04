// Records the RentCheck demo by driving the real app in Chrome. Captions and the cursor dot are overlays added
// by this script; everything else on screen is the app itself.
const puppeteer = require("puppeteer-core");
const ffmpegPath = require("ffmpeg-static");
const path = require("path");
const { execFileSync } = require("child_process");

const URL = "http://127.0.0.1:8787/";
const OUT = process.argv[2] || path.join(__dirname, "rentcheck-demo");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LISTING = `Bright 2-bed apartment in Rathmines, Dublin 6. €950 per month, all bills included.

I am currently working abroad in Spain so I can't show you the apartment. My agent will courier the keys once you pay the deposit and first month (€1,900) to secure it. Payment by Western Union. Lots of students are asking, so please confirm fast.`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
    args: ["--window-size=1440,810", "--hide-scrollbars", "--force-color-profile=srgb", "--force-prefers-reduced-motion=0"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);

  await page.evaluate(() => {
    const css = document.createElement("style");
    css.textContent = `#demoCap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:9999;background:rgba(14,21,18,.94);color:#fff;font:500 21px/1.35 Geist,system-ui,sans-serif;padding:12px 22px;border-radius:10px;max-width:1040px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .25s;letter-spacing:-.01em}
      #demoCur{position:fixed;z-index:10000;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(11,107,75,.28);border:2px solid #0B6B4B;pointer-events:none;left:720px;top:400px;transition:transform .12s}
      #demoCur.down{transform:scale(.6);background:rgba(11,107,75,.6)}
      #demoEnd{position:fixed;inset:0;z-index:10001;background:#0E1512;color:#F1F4F2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:Geist,system-ui,sans-serif;opacity:0;transition:opacity .5s}
      #demoEnd h1{font-size:76px;font-weight:600;letter-spacing:-.04em;margin:0} #demoEnd p{font-size:28px;color:#9AA29D;margin:0} #demoEnd small{font:500 15px "Geist Mono",monospace;color:#34D399;letter-spacing:.08em}`;
    document.head.appendChild(css);
    const cap = document.createElement("div"); cap.id = "demoCap"; cap.style.opacity = 0; document.body.appendChild(cap);
    const cur = document.createElement("div"); cur.id = "demoCur"; document.body.appendChild(cur);
    addEventListener("mousemove", e => { cur.style.left = e.clientX + "px"; cur.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => cur.classList.add("down"), true);
    addEventListener("mouseup", () => setTimeout(() => cur.classList.remove("down"), 140), true);
  });
  const caption = text => page.evaluate(t => { const c = document.getElementById("demoCap"); c.textContent = t; c.style.opacity = t ? 1 : 0; }, text);
  let mx = 720, my = 400;
  async function moveTo(sel, dx = 0, dy = 0) {
    const el = await page.waitForSelector(sel, { visible: true, timeout: 8000 });
    await el.evaluate(e => { const r = e.getBoundingClientRect(); if (location.hash.includes("map")) { const sd = e.closest("#mapSide"); if (sd) { const q = sd.getBoundingClientRect(); if (r.top < q.top || r.bottom > q.bottom - 90) sd.scrollTo({ top: sd.scrollTop + r.top - q.top - 80, behavior: "smooth" }); } } else if (r.top < 70 || r.bottom > innerHeight - 90) e.scrollIntoView({ block: "center", behavior: "smooth" }); });
    await sleep(450);
    const b = await el.boundingBox(); const x = b.x + b.width / 2 + dx, y = b.y + b.height / 2 + dy;
    await page.mouse.move(x, y, { steps: 28 }); mx = x; my = y; await sleep(220);
    return el;
  }
  async function click(sel, dx, dy) { await moveTo(sel, dx, dy); await page.mouse.down(); await sleep(90); await page.mouse.up(); }
  const scrollTo = (sel, block = "start") => page.evaluate((s, b) => document.querySelector(s).scrollIntoView({ block: b, behavior: "smooth" }), sel, block);

  const recorder = await page.screencast({ path: OUT + ".webm", ffmpegPath });

  // 1. Home
  await caption("RentCheck: check a Dublin rental before you send any money.");
  await sleep(3200);

  // 2. Paste a listing
  await caption("A 2-bed in Rathmines for €950 a month. Paste the ad and the messages.");
  await click("#text");
  await page.type("#text", LISTING, { delay: 9 });
  await sleep(900);
  await click("#checkBtn");
  await sleep(1300);

  // 3. Risk
  await scrollTo("#checker");
  await caption("High risk, 100 out of 100. Do not pay yet.");
  await moveTo(".risk-label");
  await sleep(2700);
  await caption("The area and rent were read from the ad, and each warning is highlighted in the text.");
  await moveTo("#marked mark");
  await sleep(2700);

  // 4. Benchmark + evidence
  await scrollTo(".figures", "center");
  await caption("€950 asked against the RTB average of €2,060 for a 2-bed apartment in Rathmines: 54% below.");
  await moveTo(".figures .figure:last-child .v");
  await sleep(3500);
  await scrollTo(".flags", "start");
  await caption("Every warning quotes the exact words from the listing. Nothing is invented.");
  await moveTo(".flags .flag:nth-child(2) blockquote");
  await sleep(3200);

  // 5. Map
  await caption("Where else could they look? Explore the area on the rent map.");
  await click("#toMap");
  await sleep(2400);
  await caption("RTB average rents around Rathmines, by area. Dots are approximate area centres.");
  await moveTo('.dot[data-n="Ranelagh, Dublin 6"]');
  await sleep(1800);
  await moveTo('.dot[data-n="Ballsbridge, Dublin 4"]');
  await sleep(2200);

  // 6. Affordability
  await caption("Set a monthly budget of €1,900. The map shows where it fits.");
  await click("#mBudget");
  await page.type("#mBudget", "1900", { delay: 160 });
  await sleep(1600);
  await caption("Green is within budget, amber is close, red is above. Rathmines itself is €160 over.");
  await moveTo(".insight p");
  await sleep(3300);
  
  await caption("Nearby alternatives, sorted by best fit for the budget.");
  await click('[data-sort="fit"]');
  await sleep(2000);
  await click('.near-row[data-area="Inchicore, Dublin 8"]');
  await caption("Inchicore: €1,856 for a 2-bed apartment, 2.6 km away, within budget.");
  await sleep(3300);

  // 7. Copilot
  await caption("Ask RentCheck Copilot. It already knows the listing, the area and the budget.");
  await click("#openCopilot");
  await sleep(1500);
  await click("#cpInput");
  await page.type("#cpInput", "Where should I look instead of Rathmines?", { delay: 28 });
  await sleep(300);
  await page.keyboard.press("Enter");
  await sleep(3200);
  await caption("The answer comes from RentCheck's tools and RTB data, with the tool and quarter shown.");
  await page.evaluate(() => { const b = document.getElementById("cpBody"); b.scrollTo({ top: 120, behavior: "smooth" }); });
  await moveTo("#cpBody .tbl");
  await sleep(3200);
  await page.evaluate(() => { const b = document.getElementById("cpBody"); b.scrollTo({ top: b.scrollHeight, behavior: "smooth" }); });
  await sleep(2000);
  await caption("And it can explain the risk, quoting the listing word for word.");
  await page.evaluate(() => { const b = [...document.querySelectorAll("#cpSuggest button")].find(x => /risky/i.test(x.textContent)); b.id = "demoRisk"; });
  await click("#demoRisk");
  await sleep(2000);
  await page.evaluate(() => { const b = document.getElementById("cpBody"), m = b.querySelectorAll(".msg.user"); m[m.length - 1].scrollIntoView({ block: "start", behavior: "smooth" }); });
  await sleep(4000);

  // 8. Close
  await caption("");
  await page.evaluate(() => {
    const e = document.createElement("div"); e.id = "demoEnd";
    e.innerHTML = "<small>RENTCHECK</small><h1>Know the rent. Spot the risk. Rent smarter.</h1><p>Official RTB data · Garda warning signs · explainable answers</p>";
    document.body.appendChild(e); requestAnimationFrame(() => { e.style.opacity = 1; });
    setInterval(() => { e.style.outlineOffset = (Math.random()) + "px"; }, 100);   // keeps frames flowing for the recorder
  });
  await sleep(3400);

  await recorder.stop();
  await browser.close();
  execFileSync(ffmpegPath, ["-y", "-i", OUT + ".webm", "-vf", "scale=1920:1080:flags=lanczos,fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", OUT + ".mp4"], { stdio: "ignore" });
  console.log("wrote", OUT + ".mp4");
})().catch(e => { console.error(e); process.exit(1); });
