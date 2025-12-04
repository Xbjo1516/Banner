import { firefox } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getRootUrl(inputUrl) {
    try {
        const u = new URL(inputUrl);
        return `${u.protocol}//${u.hostname}/`;
    } catch {
        return inputUrl;
    }
}

async function urlExists(inputUrl) {
    try {
        const res = await fetch(inputUrl);
        return res.ok;
    } catch (e) {
        return false;
    }
}

function deleteOldFolders(rootDir, prefix = "read-elements-") {
    if (!fs.existsSync(rootDir)) return;
    for (const d of fs.readdirSync(rootDir)) {
        const full = path.join(rootDir, d);
        if (fs.statSync(full).isDirectory() && d.startsWith(prefix)) {
            fs.rmSync(full, { recursive: true, force: true });
            console.log(`🧹 Deleted old test folder: ${full}`);
        }
    }
}

async function getMeta(page, selector, attr = "content") {
    const el = page.locator(selector).first();
    if (await el.count() === 0) return null;
    if (attr === "text") return await el.textContent();
    return await el.getAttribute(attr);
}

async function getTwitterMeta(page, key) {
    const el1 = page.locator(`meta[name='${key}']`).first();
    if (await el1.count()) return await el1.getAttribute("content");

    const el2 = page.locator(`meta[property='${key}']`).first();
    if (await el2.count()) return await el2.getAttribute("content");

    const el3 = page.locator(`meta[property='${key}'][name]`).first();
    if (await el3.count()) return await el3.getAttribute("content");

    return null;
}

async function analyzeMeta(url) {
    const browser = await firefox.launch({ headless: true });
    const page = await browser.newPage();

    console.log(`\n🚀 Testing banner: ${url}`);
    await page.goto(url, { waitUntil: "load" }).catch(() => { });

    const metaData = {};

    async function check(label, value) {
        return value ? `✅ ${value}` : "⛔ Not found";
    }

    metaData.priority1 = {
        charset: await check("charset", await getMeta(page, "meta[charset]", "charset")),
        viewport: await check("viewport", await getMeta(page, "meta[name='viewport']")),
        title: await check("title", await page.title()),
        description: await check("description", await getMeta(page, "meta[name='description']")),
        robots: await check("robots", await getMeta(page, "meta[name='robots']"))
    };

    // Open Graph
    metaData.openGraph = {
        "og:title": await check("og:title", await getMeta(page, "meta[property='og:title']")),
        "og:description": await check("og:description", await getMeta(page, "meta[property='og:description']")),
        "og:image": await check("og:image", await getMeta(page, "meta[property='og:image']")),
        "og:url": await check("og:url", await getMeta(page, "meta[property='og:url']")),
        "og:type": await check("og:type", await getMeta(page, "meta[property='og:type']"))
    };

    // Twitter Card
    metaData.twitter = {
        "twitter:card": await check("twitter:card", await getTwitterMeta(page, "twitter:card")),
        "twitter:title": await check("twitter:title", await getTwitterMeta(page, "twitter:title")),
        "twitter:description": await check("twitter:description", await getTwitterMeta(page, "twitter:description")),
        "twitter:image": await check("twitter:image", await getTwitterMeta(page, "twitter:image"))
    };

    // Favicon / Robots / Sitemap
    metaData.other = {
        favicon: await check("favicon", await getMeta(page, "link[rel='icon']", "href"))
    };
    try {
        const base = new URL(url).origin;
        const robots = await fetch(base + "/robots.txt");
        metaData.other["robots.txt"] = robots.status === 200 ? `✅ ${base}/robots.txt` : "⛔ Not found";
        const sitemap = await fetch(base + "/sitemap.xml");
        metaData.other["sitemap.xml"] = sitemap.status === 200 ? `✅ ${base}/sitemap.xml` : "⛔ Not found";
    } catch {
        metaData.other["robots.txt"] = "⛔ Not found";
        metaData.other["sitemap.xml"] = "⛔ Not found";
    }

    metaData.priority2 = {
        "theme-color": await check("theme-color", await getMeta(page, "meta[name='theme-color']")),
        author: await check("author", await getMeta(page, "meta[name='author']")),
        "content-type": await check("content-type", await getMeta(page, "meta[http-equiv='Content-Type']"))
    };

    await browser.close();
    return metaData;
}

// ใช้กับ Inquirer: ส่ง bannerUrls เข้ามา ไม่อ่าน process.argv แล้ว
export async function run(bannerUrls = []) {
    if (!bannerUrls || !bannerUrls.length) {
        console.log("❌ Please provide at least 1 URL");
        return;
    }

    const rootDir = path.join(__dirname, "..", "reports");
    fs.mkdirSync(rootDir, { recursive: true });
    deleteOldFolders(rootDir);

    const now = new Date();
    const timestamp =
        "read-elements-" +
        now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0") + "_" +
        String(now.getHours()).padStart(2, "0") + "-" +
        String(now.getMinutes()).padStart(2, "0") + "-" +
        String(now.getSeconds()).padStart(2, "0");

    const sessionDir = path.join(rootDir, timestamp);
    fs.mkdirSync(sessionDir);

    for (let i = 0; i < bannerUrls.length; i++) {
        const originalUrl = bannerUrls[i];
        const rootUrl = getRootUrl(originalUrl);

        console.log(`\n🔍 Check URL: ${rootUrl}`);

        const ok = await urlExists(rootUrl);
        if (!ok) {
            console.log(`\n❌ URL Not Found (no reportable issue): ${originalUrl}`);
            continue; // ไม่สร้างโฟลเดอร์
        }

        const linkDir = path.join(sessionDir, `link-${i + 1}`);
        fs.mkdirSync(linkDir);

        const metaData = await analyzeMeta(rootUrl);

        const lines = [];
        lines.push(`Original Input URL: ${originalUrl}`);
        lines.push(`Root URL Used: ${rootUrl}\n`);

        lines.push("=== charset / viewport / title / description / robots ===");
        for (const [key, value] of Object.entries(metaData.priority1)) {
            lines.push(`${key}: ${value}`);
        }
        lines.push("");

        lines.push("=== Open Graph ===");
        for (const [key, value] of Object.entries(metaData.openGraph)) {
            lines.push(`${key}: ${value}`);
        }
        lines.push("");

        lines.push("=== Twitter Card ===");
        for (const [key, value] of Object.entries(metaData.twitter)) {
            lines.push(`${key}: ${value}`);
        }
        lines.push("");

        lines.push("=== Favicon / Robots / Sitemap ===");
        for (const [key, value] of Object.entries(metaData.other)) {
            lines.push(`${key}: ${value}`);
        }
        lines.push("");

        lines.push("=== theme-color / author / content-type ===");
        for (const [key, value] of Object.entries(metaData.priority2)) {
            lines.push(`${key}: ${value}`);
        }
        lines.push("");

        fs.writeFileSync(path.join(linkDir, "report.txt"), lines.join("\n"), "utf-8");
        console.log(`📁 Saved report: ${path.join(linkDir, "report.txt")}`);
    }
}
