const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const cron = require('node-cron');
const HawaiianFontScanner = require('./font-scanner');

const app = express();
const PORT = process.env.PORT || 3001;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' })); // Large limit for base64 images
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Scanner rate limiting (more restrictive)
const scannerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5 // limit scanner endpoints to 5 requests per hour
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ===================
// FONTS ENDPOINTS
// ===================

// Get all approved fonts with pagination and filtering
app.get('/api/fonts', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      search,
      approvalStatus = 'approved',
      sortBy = 'font_family',
      sortOrder = 'asc'
    } = req.query;

    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE f.is_active = TRUE';
    const queryParams = [];
    let paramCount = 0;

    // Approval status filter
    if (approvalStatus === 'approved') {
      whereClause += ' AND (f.auto_approved = TRUE OR f.manually_approved = TRUE)';
    } else if (approvalStatus === 'pending') {
      whereClause += ' AND f.auto_approved = FALSE AND f.manually_reviewed = FALSE';
    } else if (approvalStatus === 'rejected') {
      whereClause += ' AND f.manually_approved = FALSE';
    }

    // Category filter
    if (category) {
      paramCount++;
      whereClause += ` AND f.google_font_category = $${paramCount}`;
      queryParams.push(category);
    }

    // Search filter
    if (search) {
      paramCount++;
      whereClause += ` AND f.font_family ILIKE $${paramCount}`;
      queryParams.push(`%${search}%`);
    }

    // Validate sort column
    const validSortColumns = ['font_family', 'google_font_category', 'scanned_at', 'diacritical_percentage'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'font_family';
    const order = sortOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const query = `
      SELECT 
        f.*,
        COUNT(*) OVER() as total_count,
        COALESCE(
          json_agg(
            json_build_object(
              'character', fcs.character,
              'unicode_code_point', fcs.unicode_code_point,
              'is_supported', fcs.is_supported,
              'character_type', fcs.character_type
            )
          ) FILTER (WHERE fcs.id IS NOT NULL), 
          '[]'::json
        ) as character_support
      FROM fonts f
      LEFT JOIN font_character_support fcs ON f.id = fcs.font_id
      ${whereClause}
      GROUP BY f.id
      ORDER BY f.${sortColumn} ${order}
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    queryParams.push(limit, offset);
    
    const result = await pool.query(query, queryParams);
    
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      fonts: result.rows.map(row => {
        const { total_count, ...font } = row;
        return font;
      }),
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching fonts:', error);
    res.status(500).json({ error: 'Failed to fetch fonts' });
  }
});

// Get single font details
app.get('/api/fonts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const fontQuery = `
      SELECT f.*,
        json_agg(
          json_build_object(
            'character', fcs.character,
            'unicode_code_point', fcs.unicode_code_point,
            'is_supported', fcs.is_supported,
            'character_type', fcs.character_type,
            'test_details', fcs.test_details
          )
        ) FILTER (WHERE fcs.id IS NOT NULL) as character_support
      FROM fonts f
      LEFT JOIN font_character_support fcs ON f.id = fcs.font_id
      WHERE f.id = $1 AND f.is_active = TRUE
      GROUP BY f.id
    `;

    const result = await pool.query(fontQuery, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Font not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error fetching font:', error);
    res.status(500).json({ error: 'Failed to fetch font details' });
  }
});

// Get font statistics
app.get('/api/stats', async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_fonts,
        COUNT(*) FILTER (WHERE auto_approved = TRUE OR manually_approved = TRUE) as approved_fonts,
        COUNT(*) FILTER (WHERE auto_approved = TRUE) as auto_approved_fonts,
        COUNT(*) FILTER (WHERE manually_approved = TRUE) as manually_approved_fonts,
        COUNT(*) FILTER (WHERE has_visual_distinction = TRUE) as fonts_with_distinction,
        COUNT(*) FILTER (WHERE all_diacriticals_supported = TRUE) as fonts_with_full_support,
        COUNT(DISTINCT google_font_category) as categories,
        AVG(diacritical_percentage) as avg_diacritical_support,
        MAX(scanned_at) as last_scan_date
      FROM fonts 
      WHERE is_active = TRUE
    `;

    const result = await pool.query(statsQuery);
    
    // Get category breakdown
    const categoryQuery = `
      SELECT 
        google_font_category as category,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE auto_approved = TRUE OR manually_approved = TRUE) as approved
      FROM fonts 
      WHERE is_active = TRUE AND google_font_category IS NOT NULL
      GROUP BY google_font_category
      ORDER BY approved DESC
    `;
    
    const categoryResult = await pool.query(categoryQuery);

    res.json({
      ...result.rows[0],
      categories: categoryResult.rows
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// ===================
// SCANNING ENDPOINTS
// ===================

// Start a new scan batch
app.post('/api/scan/start', scannerLimiter, async (req, res) => {
  try {
    const { 
      batchSize = 50, 
      offset = 0, 
      scanType = 'manual',
      pixelThreshold = 50 
    } = req.body;

    // Check if a scan is already running
    const runningCheck = await pool.query(
      'SELECT id FROM scan_batches WHERE status = $1',
      ['running']
    );

    if (runningCheck.rows.length > 0) {
      return res.status(409).json({ 
        error: 'A scan is already running',
        runningScanId: runningCheck.rows[0].id 
      });
    }

    // Create scan batch record
    const batchResult = await pool.query(`
      INSERT INTO scan_batches (batch_number, scan_type, batch_offset, batch_limit)
      VALUES ((SELECT COALESCE(MAX(batch_number), 0) + 1 FROM scan_batches), $1, $2, $3)
      RETURNING id, batch_number
    `, [scanType, offset, batchSize]);

    const batchId = batchResult.rows[0].id;
    const batchNumber = batchResult.rows[0].batch_number;

    // Start scanning asynchronously
    scanFontsAsync(batchId, offset, batchSize, pixelThreshold);

    res.json({
      message: 'Scan started',
      batchId,
      batchNumber,
      offset,
      limit: batchSize
    });

  } catch (error) {
    console.error('Error starting scan:', error);
    res.status(500).json({ error: 'Failed to start scan' });
  }
});

// Get scan status
app.get('/api/scan/status/:batchId?', async (req, res) => {
  try {
    const { batchId } = req.params;
    
    let query = 'SELECT * FROM scan_batches ORDER BY started_at DESC';
    let params = [];
    
    if (batchId) {
      query = 'SELECT * FROM scan_batches WHERE id = $1';
      params = [batchId];
    } else {
      query += ' LIMIT 10'; // Get recent scans
    }

    const result = await pool.query(query, params);
    
    if (batchId && result.rows.length === 0) {
      return res.status(404).json({ error: 'Scan batch not found' });
    }

    res.json(batchId ? result.rows[0] : result.rows);

  } catch (error) {
    console.error('Error fetching scan status:', error);
    res.status(500).json({ error: 'Failed to fetch scan status' });
  }
});

// ===================
// FEEDBACK ENDPOINTS
// ===================

// Submit feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { fontId, feedbackType, message, userEmail } = req.body;
    
    if (!fontId || !feedbackType || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(`
      INSERT INTO font_feedback (font_id, feedback_type, message, user_email)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [fontId, feedbackType, message, userEmail || null]);

    res.json({ 
      message: 'Feedback submitted successfully',
      feedbackId: result.rows[0].id 
    });

  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// ===================
// ADMIN ENDPOINTS (Basic)
// ===================

// Manual font approval/rejection
app.patch('/api/admin/fonts/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    const { approved, notes } = req.body;
    
    const result = await pool.query(`
      UPDATE fonts 
      SET manually_reviewed = TRUE, 
          manually_approved = $1, 
          review_notes = $2,
          last_updated = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING id, font_family, manually_approved
    `, [approved, notes || null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Font not found' });
    }

    res.json({
      message: 'Font review updated',
      font: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating font review:', error);
    res.status(500).json({ error: 'Failed to update font review' });
  }
});

// ===================
// ASYNC SCANNING LOGIC
// ===================

async function scanFontsAsync(batchId, offset, batchSize, pixelThreshold) {
  const scanner = new HawaiianFontScanner({ 
    batchSize, 
    pixelThreshold 
  });

  try {
    console.log(`🚀 Starting async scan for batch ${batchId}`);
    
    const results = await scanner.runScan({
      offset,
      limit: batchSize,
      saveToDisk: false
    });

    let processedCount = 0;
    let approvedCount = 0;

    // Insert results into database
    for (const result of results) {
      if (!result.error) {
        const fontId = await insertScanResult(result, `batch-${batchId}`);
        processedCount++;
        if (result.autoApproved) approvedCount++;
      }
    }

    // Update batch status
    await pool.query(`
      UPDATE scan_batches 
      SET status = 'completed',
          completed_at = CURRENT_TIMESTAMP,
          fonts_processed = $1,
          fonts_approved = $2,
          processing_notes = $3
      WHERE id = $4
    `, [
      processedCount, 
      approvedCount,
      `Processed ${processedCount} fonts, ${approvedCount} auto-approved`,
      batchId
    ]);

    console.log(`✅ Batch ${batchId} completed: ${processedCount} processed, ${approvedCount} approved`);

  } catch (error) {
    console.error(`❌ Batch ${batchId} failed:`, error);
    
    await pool.query(`
      UPDATE scan_batches 
      SET status = 'failed',
          completed_at = CURRENT_TIMESTAMP,
          error_message = $1
      WHERE id = $2
    `, [error.message, batchId]);
  }
}

async function insertScanResult(scanResult, batchInfo) {
  try {
    const result = await pool.query(`
      SELECT insert_scan_result($1, $2, $3, $4) as font_id
    `, [
      scanResult.fontFamily,
      JSON.stringify(scanResult.googleFontData),
      JSON.stringify(scanResult),
      batchInfo
    ]);
    
    return result.rows[0].font_id;
  } catch (error) {
    console.error('Error inserting scan result:', error);
    throw error;
  }
}

// ===================
// SCHEDULED SCANNING
// ===================

// Schedule bi-weekly incremental scans (every other Sunday at 2 AM)
cron.schedule('0 2 * * 0', async () => {
  const lastScan = await pool.query(
    'SELECT MAX(started_at) as last_scan FROM scan_batches WHERE scan_type = $1',
    ['incremental']
  );
  
  const daysSinceLastScan = lastScan.rows[0]?.last_scan 
    ? Math.floor((Date.now() - new Date(lastScan.rows[0].last_scan)) / (1000 * 60 * 60 * 24))
    : 999;

  // Only run if it's been 14+ days since last incremental scan
  if (daysSinceLastScan >= 14) {
    console.log('🕒 Starting scheduled incremental scan...');
    
    try {
      // Check for running scans
      const runningCheck = await pool.query(
        'SELECT id FROM scan_batches WHERE status = $1',
        ['running']
      );

      if (runningCheck.rows.length === 0) {
        // Start incremental scan - this would scan for new fonts only
        // Implementation would compare current Google Fonts API against our database
        console.log('Starting incremental scan for new fonts...');
        // Implementation details would go here
      }
    } catch (error) {
      console.error('Scheduled scan failed:', error);
    }
  }
}, {
  scheduled: true,
  timezone: "America/Los_Angeles" // PST/PDT
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🌺 Hawaiian Font API server running on port ${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
  
  if (process.env.NODE_ENV !== 'production') {
    console.log(`🔍 API docs available at http://localhost:${PORT}/api/`);
  }
});

module.exports = app;