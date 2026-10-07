const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// =====================================================
// FIREBASE / FIRESTORE
// =====================================================

const serviceAccountFile = path.join(
  __dirname,
  "utsavii-firebase-adminsdk-fbsvc-441f7cd5da.json",
);

let firebaseCredential;

if (fs.existsSync(serviceAccountFile)) {
  // Local development: use the downloaded Firebase service-account file.
  firebaseCredential = admin.credential.cert(require(serviceAccountFile));
} else {
  // Render/production: use environment variables.
  firebaseCredential = admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined,
  });
}

admin.initializeApp({
  credential: firebaseCredential,
});

const db = admin.firestore();

console.log("✅ Firebase Firestore connected");

// =====================================================
// APP SETUP
// =====================================================

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// HELPERS
// =====================================================

function serializeDoc(doc) {
  if (!doc.exists) return null;

  const data = doc.data();

  // Keep the same `_id` style that the old MongoDB API returned.
  data._id = doc.id;

  // Convert Firestore timestamps into JSON-friendly ISO strings.
  for (const key of Object.keys(data)) {
    if (data[key] && typeof data[key].toDate === "function") {
      data[key] = data[key].toDate().toISOString();
    }
  }

  return data;
}

function serializeSnapshot(snapshot) {
  return snapshot.docs.map((doc) => serializeDoc(doc));
}

function sortNewestFirst(items) {
  return items.sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;

    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;

    return bTime - aTime;
  });
}

// =====================================================
// SERVER TEST
// =====================================================

app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "Utsavii server is working!",
  });
});

// =====================================================
// REVIEWS
// =====================================================

// Create a review
app.post("/api/reviews", async (req, res) => {
  try {
    const { productId, customerName, rating, comment } = req.body;

    if (!productId || !customerName || !rating || !comment) {
      return res.status(400).json({
        success: false,
        message: "All review fields are required.",
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5.",
      });
    }

    const reviewData = {
      productId,
      customerName,
      rating: Number(rating),
      comment,
      approved: false,
      createdAt: new Date(),
    };

    const reviewRef = await db.collection("reviews").add(reviewData);

    const review = serializeDoc(await reviewRef.get());

    res.status(201).json({
      success: true,
      message: "Review submitted for approval.",
      review,
    });
  } catch (error) {
    console.error("Create review error:", error);

    res.status(500).json({
      success: false,
      message: "Could not create review.",
    });
  }
});

// Get approved reviews for a product
app.get("/api/reviews/product/:productId", async (req, res) => {
  try {
    const snapshot = await db
      .collection("reviews")
      .where("productId", "==", req.params.productId)
      .where("approved", "==", true)
      .get();

    const reviews = sortNewestFirst(serializeSnapshot(snapshot));

    res.json({
      success: true,
      reviews,
    });
  } catch (error) {
    console.error("Get product reviews error:", error);

    res.status(500).json({
      success: false,
      message: "Could not load reviews.",
    });
  }
});

// Backward-compatible review URL
app.get("/api/reviews/:productId", async (req, res) => {
  try {
    const snapshot = await db
      .collection("reviews")
      .where("productId", "==", req.params.productId)
      .where("approved", "==", true)
      .get();

    const reviews = sortNewestFirst(serializeSnapshot(snapshot));

    res.json({
      success: true,
      reviews,
    });
  } catch (error) {
    console.error("Get reviews error:", error);

    res.status(500).json({
      success: false,
      message: "Could not load reviews.",
    });
  }
});

// Get all reviews for admin
app.get("/api/admin/reviews", async (req, res) => {
  try {
    const snapshot = await db.collection("reviews").get();

    const reviews = sortNewestFirst(serializeSnapshot(snapshot));

    res.json({
      success: true,
      reviews,
    });
  } catch (error) {
    console.error("Get admin reviews error:", error);

    res.status(500).json({
      success: false,
      message: "Could not load admin reviews.",
    });
  }
});

// Approve a review
app.patch("/api/admin/reviews/:id/approve", async (req, res) => {
  try {
    const reviewRef = db.collection("reviews").doc(req.params.id);

    const reviewSnapshot = await reviewRef.get();

    if (!reviewSnapshot.exists) {
      return res.status(404).json({
        success: false,
        message: "Review not found.",
      });
    }

    await reviewRef.update({
      approved: true,
    });

    const review = serializeDoc(await reviewRef.get());

    res.json({
      success: true,
      message: "Review approved.",
      review,
    });
  } catch (error) {
    console.error("Approve review error:", error);

    res.status(500).json({
      success: false,
      message: "Could not approve review.",
    });
  }
});

// Hide a review
app.patch("/api/admin/reviews/:id/hide", async (req, res) => {
  try {
    const reviewRef = db.collection("reviews").doc(req.params.id);

    const reviewSnapshot = await reviewRef.get();

    if (!reviewSnapshot.exists) {
      return res.status(404).json({
        success: false,
        message: "Review not found.",
      });
    }

    await reviewRef.update({
      approved: false,
    });

    const review = serializeDoc(await reviewRef.get());

    res.json({
      success: true,
      message: "Review hidden.",
      review,
    });
  } catch (error) {
    console.error("Hide review error:", error);

    res.status(500).json({
      success: false,
      message: "Could not hide review.",
    });
  }
});

// Delete a review
app.delete("/api/admin/reviews/:id", async (req, res) => {
  try {
    const reviewRef = db.collection("reviews").doc(req.params.id);

    const reviewSnapshot = await reviewRef.get();

    if (!reviewSnapshot.exists) {
      return res.status(404).json({
        success: false,
        message: "Review not found.",
      });
    }

    await reviewRef.delete();

    res.json({
      success: true,
      message: "Review deleted.",
    });
  } catch (error) {
    console.error("Delete review error:", error);

    res.status(500).json({
      success: false,
      message: "Could not delete review.",
    });
  }
});

// =====================================================
// PRODUCTS
// =====================================================

// Get all displayed products
app.get("/api/products", async (req, res) => {
  try {
    const snapshot = await db
      .collection("products")
      .where("display", "==", true)
      .get();

    const products = sortNewestFirst(serializeSnapshot(snapshot));

    res.json({
      success: true,
      products,
    });
  } catch (error) {
    console.error("Get products error:", error);

    res.status(500).json({
      success: false,
      message: "Could not load products.",
    });
  }
});

// Get one product
app.get("/api/products/:id", async (req, res) => {
  try {
    const productSnapshot = await db
      .collection("products")
      .doc(req.params.id)
      .get();

    if (!productSnapshot.exists) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    const product = serializeDoc(productSnapshot);

    res.json({
      success: true,
      product,
    });
  } catch (error) {
    console.error("Get product error:", error);

    res.status(500).json({
      success: false,
      message: "Could not load product.",
    });
  }
});

// Create a product
app.post("/api/products", async (req, res) => {
  try {
    const product = {
      name: req.body.name,
      price: req.body.price,
      description: req.body.description || "",
      category: req.body.category || "Sarees",
      image: req.body.image || "",
      badge: req.body.badge || "",
      featured: req.body.featured || false,
      display: req.body.display !== false,
      createdAt: new Date(),
    };

    const productRef = await db.collection("products").add(product);

    const savedProduct = serializeDoc(await productRef.get());

    res.status(201).json({
      success: true,
      message: "Product created.",
      product: savedProduct,
    });
  } catch (error) {
    console.error("Create product error:", error);

    res.status(400).json({
      success: false,
      message: "Could not create product.",
      error: error.message,
    });
  }
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
  console.log(`🚀 Utsavii server running at http://localhost:${PORT}`);
});
