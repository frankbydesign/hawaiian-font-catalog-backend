# Hawaiian Font Catalog Backend

**Automated analysis of Google Fonts for proper Hawaiian diacritical mark support**

This backend service systematically evaluates Google's entire font library to identify fonts that properly display Hawaiian ʻokina and macron characters, addressing a critical gap in Hawaiian language digital typography.

## The Problem We're Solving

Hawaiian language requires specific diacritical marks that completely change word meanings when rendered incorrectly. The ʻokina (ʻ) is not an apostrophe ('), and the distinction matters both culturally and linguistically. Most fonts treat these characters identically, creating typography that ranges from incorrect to culturally insensitive.

**Example:** "Ko'u" (yours) versus "Koʻu" (mine) — same pronunciation, different meanings, different characters.

Current solutions require Hawaiian language educators and content creators to manually test hundreds of fonts, a time-intensive process that scales poorly as Google's font library grows. This project automates that evaluation process with pixel-perfect visual analysis.

## Technical Approach

The system combines browser automation, computer vision, and database analysis to evaluate font quality for Hawaiian language use:

- **Font Discovery**: Integrates with Google Fonts API to discover and prioritize fonts by popularity
- **Visual Analysis**: Uses Puppeteer to render Hawaiian characters in each font and perform pixel-by-pixel comparison
- **Character Testing**: Evaluates both ʻokina distinction and full kahakō support (ā, ē, ī, ō, ū, Ā, Ē, Ī, Ō, Ū)  
- **Automated Classification**: Auto-approves fonts meeting visual distinction thresholds while flagging edge cases for manual review
- **Batch Processing**: Optimized for resource efficiency with configurable batch sizes and rate limiting

## Architecture

```
Google Fonts API → Font Scanner → PostgreSQL Database → Express API → Frontend
```

**Core Components:**
- `font-scanner.js` - Puppeteer-based visual analysis engine
- `server.js` - Express API with scanning endpoints and database operations  
- Database schema - Comprehensive font metadata and character support tracking
- Scheduled scanning - Bi-weekly automated discovery of new fonts

## Installation & Setup

```bash
# Clone repository
git clone https://github.com/frankbydesign/hawaiian-font-catalog-backend.git
cd hawaiian-font-catalog-backend

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL and other settings

# Initialize database schema
npm run db:setup

# Start development server
npm run dev
```

## API Endpoints

### Font Catalog
- `GET /api/fonts` - List approved fonts with pagination and filtering
- `GET /api/fonts/:id` - Get detailed font analysis including character support
- `GET /api/stats` - Catalog statistics and category breakdowns

### Font Scanning  
- `POST /api/scan/start` - Trigger new scanning batch (rate limited)
- `GET /api/scan/status/:batchId` - Monitor scanning progress
- `GET /api/scan/status` - Recent scan history

### User Feedback
- `POST /api/feedback` - Submit font assessment feedback

## Scanning Configuration

The scanner supports several operational modes optimized for different use cases:

**Priority-Based Scanning**: Processes fonts by Google's popularity ranking, ensuring high-value fonts get analyzed first.

**Resource Conservation**: Designed for free hosting tiers with configurable batch sizes, execution timeouts, and memory limits.

**Incremental Updates**: Bi-weekly scans focus only on newly released fonts, avoiding redundant processing.

## Database Schema

The PostgreSQL schema tracks comprehensive font metadata:
- Font family information and Google Fonts integration data
- Character-by-character Hawaiian support analysis  
- Visual distinction measurements and auto-approval status
- User feedback and manual review workflows
- Scan batch history and performance metrics

## Development Philosophy

This project treats Hawaiian language technology as cultural preservation work, not just a technical challenge. The automated analysis scales expert human judgment about typography quality rather than replacing it. Every design decision prioritizes accuracy and cultural sensitivity over convenience or speed.

The codebase follows principles of transparency and reproducibility. All analysis criteria are documented, thresholds are configurable, and the complete evaluation process can be audited. If you disagree with a font's classification, the feedback system enables community input that improves the catalog over time.

## Contributing

Hawaiian language speakers, typography experts, and software developers are all welcome to contribute. The project particularly needs:

- Hawaiian language expertise for phrase selection and cultural guidance
- Typography knowledge for refining visual distinction algorithms  
- Web development skills for frontend integration and API enhancements
- Testing across different devices and rendering environments

## Cultural Context

This work supports broader Hawaiian language revitalization efforts by removing technical barriers to proper Hawaiian typography. Digital text rendering affects everything from educational materials to social media posts, and accurate character display represents a basic requirement for Hawaiian language digital equity.

The project acknowledges that typography serves cultural expression, not just functional communication. Getting these details right honors the people who have preserved and transmitted Hawaiian language through generations of cultural suppression and revival.

## License

MIT License - See LICENSE file for details

## Recognition

Built by Frank Brockmann ([frankbydesign](https://github.com/frankbydesign)) with deep appreciation for Hawaiian language educators and cultural practitioners whose daily work inspired this automation project.

The initial concept emerged from manual font evaluations documented by the University of Hawaiʻi's KĀ'EO program, demonstrating systematic approaches to Hawaiian font assessment that this project scales through automation.

---

*Ua mau ke ea o ka ʻāina i ka pono* - The life of the land is perpetuated in righteousness

**Status**: Active development | **Backend API**: Railway hosted | **Frontend**: Coming soon via Vercel