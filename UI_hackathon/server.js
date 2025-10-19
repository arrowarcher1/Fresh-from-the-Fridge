const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const multer = require('multer');
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');
const { S3Client } = require('@aws-sdk/client-s3');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static and body parsers
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Database setup
const dbUser = process.env.DB_USER || 'postgres';
const dbPassword = process.env.DB_PASSWORD || '';
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT || '5432';
const dbName = process.env.DB_NAME || 'recipes';

const connectionString = process.env.DATABASE_URL || `postgresql://${dbUser}:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/${dbName}`;

const pool = new Pool({ connectionString, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined });

// AWS Configuration
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const S3_BUCKET = 'fff-store';

const awsCredentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: AWS_REGION
};

// Add session token if present (for temporary credentials)
if (process.env.AWS_SESSION_TOKEN) {
  awsCredentials.sessionToken = process.env.AWS_SESSION_TOKEN;
}

AWS.config.update(awsCredentials);

// S3 Client setup
const s3ClientConfig = {
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
};

// Add session token if present
if (process.env.AWS_SESSION_TOKEN) {
  s3ClientConfig.credentials.sessionToken = process.env.AWS_SESSION_TOKEN;
}

const s3Client = new S3Client(s3ClientConfig);
const s3 = new AWS.S3();
const textract = new AWS.Textract();

// Multer S3 setup for file uploads
const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: S3_BUCKET,
    key: function (req, file, cb) {
      const timestamp = Date.now();
      const filename = `image/${timestamp}-${file.originalname}`;
      cb(null, filename);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

async function tableExists(tableName) {
  const { rows } = await pool.query('SELECT to_regclass($1) AS oid', [`public.${tableName}`]);
  return !!rows[0]?.oid;
}

async function getFridgeItems() {
  try {
    const exists = await tableExists('fridge');
    if (!exists) return [];
    const { rows } = await pool.query('SELECT id, ingredient_name, quantity, added_date FROM fridge ORDER BY added_date DESC');
    return rows;
  } catch (err) {
    console.warn('[getFridgeItems] Database error (returning empty array):', err.message);
    return [];
  }
}

function normalizeIngredient(name) {
  if (!name) return '';
  return String(name).trim().toLowerCase();
}

function generateRecipesFromIngredients(items) {
  const available = new Set(items.map((r) => normalizeIngredient(r.ingredient_name)));
  // assumed available items in pantry
  ['salt', 'pepper', 'olive oil', 'oil', 'water', 'garlic', 'onion'].forEach((s) => available.add(s));

  const recipes = [
    {
      title: 'Classic Omelette',
      required: ['eggs'],
      optional: ['cheese', 'onion', 'spinach', 'tomato'],
      instructions: 'Beat eggs, season, cook in pan with fillings until set.'
    },
    {
      title: 'Chicken Stir-Fry',
      required: ['chicken'],
      optional: ['broccoli', 'carrot', 'bell pepper', 'soy sauce', 'garlic', 'onion'],
      instructions: 'Stir-fry chicken, add veggies and sauce, cook until crisp-tender.'
    },
    {
      title: 'Tomato Basil Pasta',
      required: ['pasta', 'tomato'],
      optional: ['basil', 'parmesan', 'garlic'],
      instructions: 'Boil pasta, sauté tomatoes and garlic, toss with basil and cheese.'
    },
    {
      title: 'Veggie Fried Rice',
      required: ['rice'],
      optional: ['egg', 'peas', 'carrot', 'onion', 'soy sauce'],
      instructions: 'Fry veggies, add rice and sauce, push aside, scramble egg, combine.'
    },
    {
      title: 'Caprese Salad',
      required: ['tomato', 'mozzarella'],
      optional: ['basil', 'balsamic'],
      instructions: 'Layer tomato and mozzarella, top with basil, oil, and balsamic.'
    },
    {
      title: 'Tuna Salad',
      required: ['tuna'],
      optional: ['mayonnaise', 'celery', 'onion', 'pickle'],
      instructions: 'Mix tuna with mayo and chopped veg; season to taste.'
    },
    {
      title: 'Avocado Toast',
      required: ['bread', 'avocado'],
      optional: ['egg', 'tomato', 'feta'],
      instructions: 'Toast bread, mash avocado, season, top with extras.'
    },
    {
      title: 'Greek Yogurt Parfait',
      required: ['yogurt'],
      optional: ['berries', 'granola', 'honey'],
      instructions: 'Layer yogurt with fruit and granola; drizzle honey.'
    },
    {
      title: 'Garlic Butter Shrimp',
      required: ['shrimp'],
      optional: ['butter', 'lemon', 'parsley'],
      instructions: 'Sauté shrimp in butter and garlic; finish with lemon.'
    },
    {
      title: 'Simple Salad',
      required: ['lettuce'],
      optional: ['cucumber', 'tomato', 'cheese'],
      instructions: 'Chop and toss greens with veggies and dressing.'
    }
  ];

  function scoreRecipe(def) {
    const hasAllRequired = def.required.every((r) => available.has(normalizeIngredient(r)));
    if (!hasAllRequired) return -1;
    const optionalHitCount = def.optional.filter((o) => available.has(normalizeIngredient(o))).length;
    // Score favors required satisfaction and optional matches
    return 10 + optionalHitCount;
  }

  return recipes
    .map((def) => ({
      title: def.title,
      instructions: def.instructions,
      required: def.required,
      optional: def.optional,
      score: scoreRecipe(def)
    }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

async function fetchRecipesFromDb() {
  const exists = await tableExists('recipes');
  if (!exists) return [];

  // Inspect available columns
  const { rows: cols } = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'recipes'`
  );

  const columnNames = cols.map((c) => c.column_name.toLowerCase());
  const titleCol = ['title', 'name'].find((c) => columnNames.includes(c));
  const instrCol = ['instructions', 'directions', 'steps', 'method', 'description'].find((c) => columnNames.includes(c));
  const ingredientsCol = ['ingredients', 'ingredient_list', 'ingredients_text', 'ingredients_json', 'ingredients_array'].find((c) => columnNames.includes(c));

  const selectedCols = [titleCol, instrCol, ingredientsCol].filter(Boolean).join(', ');
  const selectSql = selectedCols.length ? `SELECT ${selectedCols} FROM recipes` : 'SELECT * FROM recipes';
  const { rows } = await pool.query(selectSql);

  return rows.map((r) => {
    const title = titleCol ? r[titleCol] : (r.title || r.name || 'Recipe');
    const instructions = instrCol ? r[instrCol] : (r.instructions || r.directions || r.steps || r.method || r.description || '');
    let ingredients = [];
    if (ingredientsCol) {
      const raw = r[ingredientsCol];
      if (Array.isArray(raw)) {
        ingredients = raw;
      } else if (typeof raw === 'string') {
        try {
          const maybeJson = JSON.parse(raw);
          if (Array.isArray(maybeJson)) ingredients = maybeJson;
          else ingredients = String(raw).split(/,|\n|;|\|/).map((s) => s.trim()).filter(Boolean);
        } catch (_) {
          ingredients = String(raw).split(/,|\n|;|\|/).map((s) => s.trim()).filter(Boolean);
        }
      }
    }
    return { title, instructions, ingredients };
  });
}

async function fetchSuggestedRecipes() {
  try {
    const hasSug = await tableExists('sug_recipes');
    const hasRec = await tableExists('recipes');
    if (!hasSug || !hasRec) return [];

    const sql = `
      SELECT s.id AS sug_id, r.id AS recipe_id, r.name, r.ingredients, r.steps, r.description, r.minutes
      FROM sug_recipes s
      JOIN recipes r ON r.id = s.recipe_id
      ORDER BY s.id DESC
      LIMIT 100
    `;
    const { rows } = await pool.query(sql);
    console.log('[fetchSuggestedRecipes] Sample row:', rows[0]); // Debug

  function parseIngredients(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    const str = String(raw);
    try {
      const maybe = JSON.parse(str);
      if (Array.isArray(maybe)) return maybe;
    } catch (_) {}
    return str
      .split(/,|\n|;|\||\u2022|\t/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function parseSteps(raw) {
    if (!raw) return [];
    const normalize = (value) => String(value).trim();
    const toList = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      const str = String(value);
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) return parsed;
        if (typeof parsed === 'string') return parsed.split(/\n+|\r+|\.|;/).map(normalize).filter(Boolean);
      } catch (_) {}
      return str.split(/\n+|\r+|\.|;/).map(normalize).filter(Boolean);
    };
    return toList(raw);
  }

  const result = rows.map((r) => ({
    sugId: r.sug_id,
    recipeId: r.recipe_id,
    title: r.name || 'Recipe',
    description: r.description || '',
    instructions: parseSteps(r.steps),
    ingredients: parseIngredients(r.ingredients),
    minutes: r.minutes 
  }));
  console.log('[fetchSuggestedRecipes] First recipe - description:', result[0]?.description?.substring(0, 50));
  console.log('[fetchSuggestedRecipes] First recipe - instructions:', (result[0]?.instructions || []).slice(0, 3));
  return result;
  } catch (err) {
    console.warn('[fetchSuggestedRecipes] Database error (returning empty array):', err.message);
    return [];
  }
}

// Textract processing functions
async function extractTextFromImage(s3Key) {
  try {
    const params = {
      Document: {
        S3Object: {
          Bucket: S3_BUCKET,
          Name: s3Key
        }
      },
      FeatureTypes: ['TABLES', 'FORMS']
    };

    const result = await textract.analyzeDocument(params).promise();
    
    // Extract all text from blocks
    let fullText = '';
    if (result.Blocks) {
      result.Blocks.forEach(block => {
        if (block.BlockType === 'LINE' && block.Text) {
          fullText += block.Text + '\n';
        }
      });
    }
    
    return fullText;
  } catch (error) {
    console.error('Textract error:', error);
    throw new Error('Failed to extract text from image: ' + error.message);
  }
}

function parseIngredientsFromText(text) {
  const ingredients = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Common ingredient keywords and patterns
  const ingredientKeywords = ['ingredient', 'ingredients:', 'you will need', 'you\'ll need', 'materials', 'supplies'];
  const stopKeywords = ['instruction', 'directions', 'steps', 'method', 'preparation', 'procedure'];
  
  let inIngredientsSection = false;
  let foundIngredientHeader = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();
    
    // Check if we've hit the ingredients section
    if (ingredientKeywords.some(kw => lineLower.includes(kw))) {
      inIngredientsSection = true;
      foundIngredientHeader = true;
      continue;
    }
    
    // Check if we've left the ingredients section
    if (inIngredientsSection && stopKeywords.some(kw => lineLower.includes(kw))) {
      break;
    }
    
    // If we found an ingredient header or we're in a list-like format, extract ingredients
    if (inIngredientsSection || (!foundIngredientHeader && (line.match(/^[-•*\d.)]/) || line.match(/^\d+\s*(cup|tablespoon|teaspoon|oz|lb|g|kg|ml|l)/i)))) {
      // Clean up the line
      let ingredient = line
        .replace(/^[-•*\d.)]+\s*/, '') // Remove bullets and numbers
        .replace(/\d+\s*(cup|tablespoon|teaspoon|tsp|tbsp|oz|ounce|pound|lb|gram|g|kg|ml|liter|l)s?\s*/gi, '') // Remove measurements
        .replace(/\(\s*.*?\s*\)/g, '') // Remove parenthetical notes
        .trim();
      
      // Extract just the ingredient name (first few words)
      const words = ingredient.split(/\s+/);
      if (words.length > 0 && words.length <= 4) {
        ingredient = words.join(' ').toLowerCase();
        
        // Filter out very short or invalid entries
        if (ingredient.length > 2 && !ingredient.match(/^(to|the|and|or|for|of|in|a|an)$/i)) {
          ingredients.push(ingredient);
        }
      } else if (words.length > 4) {
        // Take the last 2-3 words as the ingredient name (e.g., "2 cups all purpose flour" -> "all purpose flour")
        const potentialIngredient = words.slice(-3).join(' ').toLowerCase();
        if (potentialIngredient.length > 2) {
          ingredients.push(potentialIngredient);
        }
      }
      
      inIngredientsSection = true;
    }
  }
  
  // If we didn't find a clear ingredients section, try to extract food-related words
  if (ingredients.length === 0) {
    const commonIngredients = [
      'flour', 'sugar', 'salt', 'pepper', 'butter', 'oil', 'egg', 'milk', 'cream', 'cheese',
      'chicken', 'beef', 'pork', 'fish', 'shrimp', 'salmon', 'tuna',
      'tomato', 'onion', 'garlic', 'carrot', 'celery', 'potato', 'lettuce', 'spinach',
      'rice', 'pasta', 'bread', 'noodle', 'quinoa',
      'basil', 'oregano', 'thyme', 'parsley', 'cilantro', 'rosemary',
      'lemon', 'lime', 'orange', 'apple', 'banana',
      'vanilla', 'cinnamon', 'paprika', 'cumin', 'chili',
      'soy sauce', 'vinegar', 'mustard', 'mayonnaise', 'ketchup'
    ];
    
    const textLower = text.toLowerCase();
    commonIngredients.forEach(ing => {
      if (textLower.includes(ing) && !ingredients.includes(ing)) {
        ingredients.push(ing);
      }
    });
  }
  
  // Remove duplicates and return
  return [...new Set(ingredients)];
}

async function addIngredientToFridge(ingredientName) {
  const exists = await tableExists('fridge');
  if (!exists) {
    throw new Error('Fridge table does not exist');
  }
  
  // Check if ingredient already exists
  const checkQuery = 'SELECT id FROM fridge WHERE LOWER(ingredient_name) = LOWER($1)';
  const checkResult = await pool.query(checkQuery, [ingredientName]);
  
  if (checkResult.rows.length > 0) {
    // Update quantity if it exists
    const updateQuery = 'UPDATE fridge SET quantity = quantity + 1, added_date = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *';
    const result = await pool.query(updateQuery, [checkResult.rows[0].id]);
    return result.rows[0];
  } else {
    // Insert new ingredient
    const insertQuery = 'INSERT INTO fridge (ingredient_name, quantity, added_date) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING *';
    const result = await pool.query(insertQuery, [ingredientName, 1]);
    return result.rows[0];
  }
}

// Routes
app.get('/', async (req, res) => {
  try {
    const items = await getFridgeItems();
    res.render('index', { items });
  } catch (err) {
    // Log detailed error server-side for diagnostics
    console.error('[GET /] Error loading fridge:', err);
    // Render with empty items if database fails
    res.render('index', { items: [] });
  }
});

app.get('/api/fridge', async (req, res) => {
  try {
    const items = await getFridgeItems();
    res.json({ items });
  } catch (err) {
    console.error('[GET /api/fridge] Error:', err);
    res.status(500).json({ error: err?.message || err?.code || String(err) });
  }
});

// Read-only mode: disable writes
app.post('/fridge', (req, res) => {
  res.status(403).send('Read-only mode: writing to fridge is disabled');
});

app.post('/fridge/:id/delete', (req, res) => {
  res.status(403).send('Read-only mode: deletions are disabled');
});

app.get('/recipes', async (req, res) => {
  try {
    const items = await getFridgeItems();
    const available = new Set(items.map((r) => normalizeIngredient(r.ingredient_name)));

    // Only use suggestions from sug_recipes -> recipes (no fallback)
    const suggestions = await fetchSuggestedRecipes();
    const recipes = suggestions
      .map((rec) => {
        const ing = (rec.ingredients || []).map((x) => normalizeIngredient(x));
        const hits = ing.filter((i) => available.has(i)).length;
        
        // Format instructions: convert array to nicely formatted sentences
        let formattedInstructions = '';
        if (Array.isArray(rec.instructions) && rec.instructions.length > 0) {
          formattedInstructions = rec.instructions
            .map((step) => {
              const trimmed = String(step).trim();
              if (!trimmed) return '';
              // Capitalize first letter
              const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
              // Add period if not already ending with punctuation
              return capitalized.match(/[.!?]$/) ? capitalized : capitalized + '.';
            })
            .filter(Boolean)
            .join(' ');
        } else if (typeof rec.instructions === 'string') {
          formattedInstructions = rec.instructions;
        }
        
        return { 
          title: rec.title, 
          description: rec.description || '', 
          instructions: formattedInstructions || 'No cooking steps available.', 
          required: [], 
          optional: ing, 
          score: hits 
        };
      })
      .sort((a, b) => b.score - a.score);

    res.render('recipes', { recipes });
  } catch (err) {
    console.error('[GET /recipes] Error generating recipes:', err);
    // Render with empty recipes if database fails
    res.render('recipes', { recipes: [] });
  }
});

// Health endpoint for DB diagnostics
app.get('/health', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const now = await client.query('SELECT now() as now');
      let fridgeCount = null;
      if (await tableExists('fridge')) {
        const count = await client.query('SELECT COUNT(*)::int AS c FROM fridge');
        fridgeCount = count.rows[0]?.c;
      }
      const hasRecipes = await tableExists('recipes');
      res.json({
        ok: true,
        db: {
          now: now.rows[0]?.now,
          fridgeCount,
          hasRecipes
        }
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[GET /health] DB health check failed:', err);
    res.status(500).json({ ok: false, error: err?.message || err?.code || String(err), db: { host: dbHost, name: dbName, ssl: process.env.DB_SSL === 'true' } });
  }
});

// Upload receipt photo page
app.get('/upload', (req, res) => {
  res.render('upload');
});

// API endpoint to handle receipt photo upload
app.post('/api/upload-receipt', (req, res) => {
  // Use multer with error handling
  upload.single('receiptImage')(req, res, async (uploadErr) => {
    try {
      // Check for multer/S3 upload errors
      if (uploadErr) {
        console.error('[Upload] File upload error:', uploadErr);
        
        // Check if it's an AWS credentials error
        if (uploadErr.message && uploadErr.message.includes('credential')) {
          return res.status(500).json({ 
            success: false, 
            error: 'AWS credentials not configured. Please add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to your .env file.' 
          });
        }
        
        return res.status(400).json({ 
          success: false, 
          error: uploadErr.message || 'Failed to upload file' 
        });
      }
      
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No image file uploaded' });
      }

      // Get S3 key from multer-s3
      const s3Key = req.file.key;
      const s3Location = req.file.location;
      console.log('[Upload] Receipt uploaded to S3:', s3Key);
      console.log('[Upload] S3 Location:', s3Location);
      console.log('[Upload] Lambda will process this receipt and update the fridge');

      // Return success immediately - Lambda will process asynchronously
      res.json({
        success: true,
        message: 'Receipt uploaded successfully! Your fridge will be updated shortly.',
        s3Key: s3Key,
        s3Location: s3Location
      });

    } catch (err) {
      console.error('[POST /api/upload-receipt] Error:', err);

      res.status(500).json({ 
        success: false, 
        error: err?.message || 'Failed to upload receipt image'
      });
    }
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Fresh from the Fridge running on http://localhost:${PORT}`);
});


