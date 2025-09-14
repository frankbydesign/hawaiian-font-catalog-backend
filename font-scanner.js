const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class HawaiianFontScanner {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 50;
    this.googleFontsApiKey = process.env.GOOGLE_FONTS_API_KEY || null; // Optional for better rate limits
    this.pixelThreshold = options.pixelThreshold || 50; // Minimum pixel difference for auto-approval
    this.testPhrase = "Ua mau ke ea o ka ʻĀina i ka pono";
    this.testCharacters = {
      okina: 'ʻ', // U+02BB
      apostrophe: "'", // U+0027
      lowercase: ['ā', 'ē', 'ī', 'ō', 'ū'],
      uppercase: ['Ā', 'Ē', 'Ī', 'Ō', 'Ū']
    };
    this.browser = null;
  }

  async initialize() {
    console.log('🚀 Initializing Hawaiian Font Scanner...');
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });
    console.log('✅ Browser initialized');
  }

  async fetchGoogleFonts(offset = 0, limit = null) {
    try {
      const baseUrl = 'https://www.googleapis.com/webfonts/v1/webfonts';
      const params = new URLSearchParams({
        sort: 'popularity', // Start with most popular fonts
        ...(this.googleFontsApiKey && { key: this.googleFontsApiKey })
      });

      const response = await axios.get(`${baseUrl}?${params}`);
      let fonts = response.data.items;

      // Apply offset and limit for batching
      if (offset > 0) {
        fonts = fonts.slice(offset);
      }
      if (limit) {
        fonts = fonts.slice(0, limit);
      }

      console.log(`📚 Fetched ${fonts.length} fonts from Google Fonts API`);
      return fonts;
    } catch (error) {
      console.error('❌ Error fetching Google Fonts:', error.message);
      throw error;
    }
  }

  async analyzeFontCharacters(fontFamily) {
    const page = await this.browser.newPage();
    
    try {
      // Create HTML with font loaded from Google Fonts
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@400&display=swap" rel="stylesheet">
          <style>
            body { margin: 0; padding: 20px; background: white; }
            .test-container { font-family: "${fontFamily}", sans-serif; font-size: 48px; line-height: 1.2; }
            .character-test { display: inline-block; margin: 10px; padding: 10px; border: 1px solid #ccc; }
            .phrase-test { font-size: 24px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="test-container">
            <div id="okina-test" class="character-test">${this.testCharacters.okina}</div>
            <div id="apostrophe-test" class="character-test">${this.testCharacters.apostrophe}</div>
            <div id="lowercase-test" class="character-test">${this.testCharacters.lowercase.join(' ')}</div>
            <div id="uppercase-test" class="character-test">${this.testCharacters.uppercase.join(' ')}</div>
            <div id="phrase-test" class="phrase-test">${this.testPhrase}</div>
          </div>
        </body>
        </html>
      `;

      await page.setContent(html);
      
      // Wait for font to load
      await page.waitForTimeout(2000);

      // Take screenshots of individual character tests
      const okenElement = await page.$('#okina-test');
      const apostropheElement = await page.$('#apostrophe-test');
      
      const okenScreenshot = await okenElement.screenshot();
      const apostropheScreenshot = await apostropheElement.screenshot();

      // Simple pixel difference calculation
      const pixelDifference = this.compareImages(okenScreenshot, apostropheScreenshot);
      
      // Test Hawaiian diacritical characters rendering
      const diacriticalTest = await this.testDiacriticalCharacters(page);
      
      // Test phrase rendering
      const phraseElement = await page.$('#phrase-test');
      const phraseScreenshot = await phraseElement.screenshot();

      return {
        fontFamily,
        okenVsApostropheDifference: pixelDifference,
        hasVisualDistinction: pixelDifference > this.pixelThreshold,
        diacriticalSupport: diacriticalTest,
        phrasePreview: phraseScreenshot.toString('base64'),
        autoApproved: pixelDifference > this.pixelThreshold && diacriticalTest.allSupported
      };

    } catch (error) {
      console.error(`❌ Error analyzing font ${fontFamily}:`, error.message);
      return {
        fontFamily,
        error: error.message,
        autoApproved: false
      };
    } finally {
      await page.close();
    }
  }

  async testDiacriticalCharacters(page) {
    try {
      const allCharacters = [...this.testCharacters.lowercase, ...this.testCharacters.uppercase];
      const results = {};
      
      for (const char of allCharacters) {
        // Test if character renders differently from a generic rectangle/missing glyph
        const testHtml = `<div style="font-family: inherit; font-size: 48px;">${char}</div>`;
        
        await page.evaluate((html) => {
          const testDiv = document.createElement('div');
          testDiv.innerHTML = html;
          document.body.appendChild(testDiv);
          return testDiv;
        }, testHtml);

        // Simple test: if the character width is reasonable, it's likely supported
        const charWidth = await page.evaluate((character) => {
          const span = document.createElement('span');
          span.style.fontSize = '48px';
          span.style.fontFamily = 'inherit';
          span.textContent = character;
          document.body.appendChild(span);
          const width = span.offsetWidth;
          document.body.removeChild(span);
          return width;
        }, char);

        results[char] = charWidth > 10; // Basic test - if it has reasonable width, it's rendered
      }

      const supportedCount = Object.values(results).filter(Boolean).length;
      const totalCount = allCharacters.length;

      return {
        individual: results,
        supportedCount,
        totalCount,
        allSupported: supportedCount === totalCount,
        percentageSupported: (supportedCount / totalCount) * 100
      };

    } catch (error) {
      console.error('Error testing diacritical characters:', error.message);
      return {
        individual: {},
        supportedCount: 0,
        totalCount: 0,
        allSupported: false,
        percentageSupported: 0
      };
    }
  }

  compareImages(img1Buffer, img2Buffer) {
    // Simple comparison - count different bytes
    // In production, you might want a more sophisticated image comparison
    if (img1Buffer.length !== img2Buffer.length) {
      return Math.abs(img1Buffer.length - img2Buffer.length);
    }

    let differences = 0;
    for (let i = 0; i < img1Buffer.length; i++) {
      if (img1Buffer[i] !== img2Buffer[i]) {
        differences++;
      }
    }

    return differences;
  }

  async scanFontBatch(offset = 0, limit = null) {
    console.log(`🔍 Starting font batch scan (offset: ${offset}, limit: ${limit || 'all'})`);
    
    const fonts = await this.fetchGoogleFonts(offset, limit || this.batchSize);
    const results = [];

    for (let i = 0; i < fonts.length; i++) {
      const font = fonts[i];
      console.log(`📝 Analyzing font ${i + 1}/${fonts.length}: ${font.family}`);
      
      const analysis = await this.analyzeFontCharacters(font.family);
      
      // Add Google Fonts metadata
      const result = {
        ...analysis,
        googleFontData: {
          family: font.family,
          variants: font.variants,
          subsets: font.subsets,
          version: font.version,
          lastModified: font.lastModified,
          files: font.files,
          category: font.category
        },
        scannedAt: new Date().toISOString(),
        scanBatch: `${offset}-${offset + (limit || this.batchSize)}`
      };

      results.push(result);

      // Small delay to be nice to resources
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ Batch scan complete. Analyzed ${results.length} fonts`);
    console.log(`🎯 Auto-approved fonts: ${results.filter(r => r.autoApproved).length}`);
    
    return results;
  }

  async saveResults(results, batchNumber = 0) {
    const filename = `scan-results-batch-${batchNumber}-${Date.now()}.json`;
    const filepath = path.join(__dirname, 'scan-results', filename);
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    
    await fs.writeFile(filepath, JSON.stringify(results, null, 2));
    console.log(`💾 Results saved to ${filepath}`);
    
    return filepath;
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      console.log('🧹 Browser cleanup complete');
    }
  }

  // Main scanning method for different use cases
  async runScan(options = {}) {
    const { 
      offset = 0, 
      limit = this.batchSize, 
      saveToDisk = true,
      batchNumber = 0 
    } = options;

    try {
      await this.initialize();
      const results = await this.scanFontBatch(offset, limit);
      
      if (saveToDisk) {
        await this.saveResults(results, batchNumber);
      }

      return results;

    } catch (error) {
      console.error('❌ Scan failed:', error.message);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// CLI usage example
async function main() {
  const scanner = new HawaiianFontScanner({
    batchSize: 50,
    pixelThreshold: 50
  });

  try {
    // Scan first batch of 50 most popular fonts
    console.log('🎯 Scanning top 50 most popular Google Fonts...');
    const results = await scanner.runScan({
      offset: 0,
      limit: 50,
      batchNumber: 1
    });

    console.log('\n📊 SCAN SUMMARY:');
    console.log(`Total fonts analyzed: ${results.length}`);
    console.log(`Auto-approved fonts: ${results.filter(r => r.autoApproved).length}`);
    console.log(`Fonts with visual distinction: ${results.filter(r => r.hasVisualDistinction).length}`);
    console.log(`Fonts with full diacritical support: ${results.filter(r => r.diacriticalSupport?.allSupported).length}`);

    // Show top approved fonts
    const approved = results.filter(r => r.autoApproved);
    if (approved.length > 0) {
      console.log('\n🎉 AUTO-APPROVED FONTS:');
      approved.forEach(font => {
        console.log(`  ✅ ${font.fontFamily} (${font.okenVsApostropheDifference} pixel diff, ${font.diacriticalSupport?.percentageSupported}% diacritical support)`);
      });
    }

  } catch (error) {
    console.error('💥 Scan failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = HawaiianFontScanner;