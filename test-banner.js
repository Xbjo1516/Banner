const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    const bannerUrls = [
        "https://dashboard.adserve.zone/test-404",
        "https://dashboard.adserve.zone/test-404/normal.html", //ไม่ติด
        "https://dashboard.adserve.zone/test-404/404-index.html", //ติด 404 หน้าเพจไม่มีอะไรแสดงได้เลย
        "https://dashboard.adserve.zone/test-404/404-some-asset.html", //ติดบางอย่างในเฟรม
    ];

    const allReports = [];

    for (const url of bannerUrls) {
        console.log(`\n🚀 Testing banner: ${url}`);

        const issues = {
            iframe404s: [],
            assetFailures: [],
            allIframes: [],
            pageStatus: null,
        };

        // Monitor responses only for dashboard (iframe case)
        if (url.includes("dashboard.adserve.zone/test-404")) {
            page.on("response", async (response) => {
                const frame = response.frame();
                const isInIframe = frame.parentFrame() !== null;
                const status = response.status();
                const resourceType = response.request().resourceType();

                if (isInIframe && status === 404) {
                    if (resourceType === "document") {
                        issues.iframe404s.push({
                            iframeUrl: frame.url(),
                            parentUrl: frame.parentFrame().url(),
                            status,
                            timestamp: new Date().toISOString(),
                        });
                        console.log(`🚨 iframe 404 (document): ${frame.url()}`);
                    } else {
                        issues.assetFailures.push({
                            type: resourceType,
                            iframeUrl: frame.url(),
                            status,
                            timestamp: new Date().toISOString(),
                        });
                        console.log(`⚠️ Asset 404 in iframe → Inside iframe: ${frame.url()}`);
                    }
                }
            });
        }

        await page.goto(url, { waitUntil: "networkidle" });

        if (url.includes("dashboard.adserve.zone/test-404")) {
            // console.log("🔄 Refreshing dashboard page before testing...");
            // await page.reload({ waitUntil: "networkidle" });
            await page.waitForTimeout(10000);

            // เก็บข้อมูล iframe
            const frames = page.frames();
            for (const frame of frames) {
                if (frame.parentFrame()) {
                    issues.allIframes.push({
                        url: frame.url(),
                        name: frame.name(),
                        hasError: issues.iframe404s.some(err => err.iframeUrl === frame.url()),
                    });

                    try {
                        const title = await frame.title();
                        console.log(`🔍 Iframe loaded: ${frame.url()} → Title: ${title}`);
                    } catch {
                        console.log(`⛔ Cannot access DOM of iframe (cross-origin): ${frame.url()}`);
                    }
                }
            }
        } else {
            const response = await page.goto(url, { waitUntil: "domcontentloaded" });
            issues.pageStatus = response.status();
            if (issues.pageStatus === 404) {
                console.log(`🚨 Page 404: ${url}`);
            } else {
                console.log(`✅ Page loaded OK: ${url} (status ${issues.pageStatus})`);
            }
        }

        if (
            issues.iframe404s.length === 0 &&
            issues.assetFailures.length === 0 &&
            (!issues.pageStatus || issues.pageStatus !== 404)
        ) {
            console.log(`✅ Summary: ${url} → No 404`);
        } else {
            console.log(`❌ Summary: ${url} → issues found`);
            if (issues.iframe404s.length > 0) {
                console.log(`   - iframe 404: ${issues.iframe404s.length}`);
            }
            if (issues.assetFailures.length > 0) {
                console.log(`   - asset failures: ${issues.assetFailures.length}`);
            }
            if (issues.pageStatus === 404) {
                console.log(`   - page 404`);
            }
        }

        allReports.push({ bannerUrl: url, issues });
    }

    await browser.close();

    const reportDir = path.join(__dirname, "reports");

    if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportPath = path.join(reportDir, "iframe-404-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(allReports, null, 2));

    console.log(`\n💾 Report saved to: ${reportPath}`);

})(); 
