
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

app.use(cors());
app.use(express.json());

const username = encodeURIComponent(process.env.DB_USER);
const password = encodeURIComponent(process.env.DB_PASSWORD);

const uri = `mongodb://${username}:${password}@ac-qmflq3w-shard-00-00.bmqtlfl.mongodb.net:27017,ac-qmflq3w-shard-00-01.bmqtlfl.mongodb.net:27017,ac-qmfl3w-shard-00-02.bmqtlfl.mongodb.net:27017/hireloopdb?tls=true&replicaSet=atlas-7oshzy-shard-0&authSource=admin&retryWrites=true&w=majority`;

const client = new MongoClient(uri);

await client.connect();

console.log("MongoDB Connected Successfully");

const db = client.db("hireloopdb");

const users = db.collection("user");
const jobs = db.collection("jobs");
const applications = db.collection("applications");
const savedJobs = db.collection("savedJobs");
const payments = db.collection("payments");
const sessions = db.collection("session");


const validId = (value) => ObjectId.isValid(value);
const id = (value) => new ObjectId(value);

// Home
app.get("/", (req, res) => {
  res.send("HireLoop Server Running");
});

// Authentication


const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Check received token
    console.log("Authorization Header:", authHeader);

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).send({
        success: false,
        message: "Unauthorized",
      });
    }

    const token = authHeader.slice(7);

    const session = await sessions.findOne({ token });
    console.log("SESSION FOUND:", !!session);

    if (!session) {
      return res.status(401).send({
        success: false,
        message: "Invalid session",
      });
    }

    if (
      !session.expiresAt ||
      new Date(session.expiresAt).getTime() <= Date.now()
    ) {
      return res.status(401).send({
        success: false,
        message: "Session expired",
      });
    }

    const userId = String(session.userId);

    let user = await users.findOne({ _id: userId });

    if (!user && ObjectId.isValid(userId)) {
      user = await users.findOne({
        _id: new ObjectId(userId),
      });
    }
console.log("USER FOUND:", !!user);
console.log("USER ROLE:", user?.role);
    if (!user || user.banned === true) {
      return res.status(401).send({
        success: false,
        message: "User not found or suspended",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication Error:", error);

    return res.status(500).send({
      success: false,
      message: "Authentication failed",
    });
  }
};


// Recruiter Only

const verifyRecruiter = (req, res, next) => {
  console.log("CHECKING ROLE:", req.user.role);

  if (req.user.role !== "recruiter") {
    return res.status(403).send({
      success: false,
      message: "Recruiter access required",
    });
  }

  console.log("RECRUITER ACCESS GRANTED");
  next();
};
// Recruiter or Admin

const verifyRecruiterOrAdmin = (req, res, next) => {
  console.log("CHECKING ROLE:", req.user.role);

  if (!["recruiter", "admin"].includes(req.user.role)) {
    return res.status(403).send({
      success: false,
      message: "Access denied",
    });
  }

  console.log("RECRUITER/ADMIN ACCESS GRANTED");
  next();
};

// Seeker Only
const verifySeeker = (req, res, next) => {
  if (req.user.role !== "seeker") {
    return res.status(403).send({
      success: false,
      message: "Job seeker access required",
    });
  }

  next();
};
// Admin Only

const verifyAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).send({
      success: false,
      message: "Admin access required",
    });
  }

  next();
};

// Get User ID

const getUserId = (user) => String(user._id || user.id);


// Jobs

app.get("/jobs", async (req, res) => {
  try {
    const {
      search,
      category,
      location,
      type,
      workplace,
      requirements,
    } = req.query;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 20;

    const query = {};
    const filters = [];

    const getRegex = (value) =>
      new RegExp(
        String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );

    if (search) {
      const regex = getRegex(search);

      filters.push({
        $or: [
          { title: regex },
          { company: regex },
          { description: regex },
        ],
      });
    }

    if (category) {
      filters.push({ category: getRegex(category) });
    }

    if (location) {
      filters.push({ location: getRegex(location) });
    }

    if (type) {
      const regex = getRegex(type);

      filters.push({
        $or: [
          { type: regex },
          { jobType: regex },
        ],
      });
    }

    if (workplace) {
      filters.push({ workplace: getRegex(workplace) });
    }

    if (requirements) {
      filters.push({ requirements: getRegex(requirements) });
    }

    if (filters.length > 0) {
      query.$and = filters;
    }

    const totalJobs = await jobs.countDocuments(query);

    const totalPages = Math.ceil(totalJobs / limit);

    const result = await jobs
      .find(query)
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    const formattedJobs = result.map((job) => ({
      ...job,
      type: job.type || job.jobType || "",
    }));

    res.status(200).send({
      success: true,
      jobs: formattedJobs,
      totalJobs,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("GET JOBS ERROR:", error);

    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});



// Get Recruiter's Own Jobs

app.get(
  "/recruiter/jobs",
  verifyToken,
  verifyRecruiterOrAdmin,
  async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = 10;

      const query =
        req.user.role === "admin"
          ? {}
          : { recruiterId: getUserId(req.user) };

      const totalJobs = await jobs.countDocuments(query);

      const result = await jobs
        .find(query)
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray();

      res.send({
        success: true,
        jobs: result,
        totalJobs,
        totalPages: Math.ceil(totalJobs / limit),
        currentPage: page,
      });
    } catch (error) {
      console.error("Recruiter Jobs Error:", error);

      res.status(500).send({
        success: false,
        message: "Failed to get recruiter jobs",
      });
    }
  }
);


// Recent Jobs
app.get("/recent-jobs", async (req, res) => {
  try {
    const result = await jobs
      .find({})
      .sort({ _id: -1 })
      .limit(10)
      .toArray();

    res.send(result);
  } catch (error) {
    console.error("Recent Jobs Error:", error);

    res.status(500).send({
      message: "Failed to get recent jobs",
    });
  }
});

// Get Single Job
app.get("/jobs/:id", async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).send("Invalid ID");
    }

    const result = await jobs.findOne({
      _id: id(req.params.id),
    });

    if (!result) {
      return res.status(404).send({
        message: "Job not found",
      });
    }

    res.send(result);
  } catch (error) {
    console.error("Get Single Job Error:", error);

    res.status(500).send({
      message: "Failed to get job",
    });
  }
});

// Create Job

app.post("/jobs", verifyToken, verifyRecruiter, async (req, res) => {
  try {
    const {
      title,
      company,
      category,
      jobType,
      workplace,
      location,
      salary,
      deadline,
      description,
      requirements,
    } = req.body;

    if (!title || !company) {
      return res.status(400).send({
        success: false,
        message: "Title and company are required",
      });
    }

    const jobData = {
      title,
      company,
      category,
      jobType,
      workplace,
      location,
      salary,
      deadline,
      description,
      requirements,

      recruiterId: getUserId(req.user),
      recruiterName: req.user.name,
      recruiterEmail: req.user.email,

      createdAt: new Date(),
      status: "Active",
      applications: 0,
    };

    const result = await jobs.insertOne(jobData);

    res.status(201).send({
      success: true,
      message: "Job published successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Create Job Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to publish job",
    });
  }
});

// Get Applicants

app.get(
  "/jobs/:jobId/applications",
  verifyToken,
  verifyRecruiterOrAdmin,
  async (req, res) => {
    try {
      const { jobId } = req.params;

      if (!validId(jobId)) {
        return res.status(400).send({
          success: false,
          message: "Invalid job ID",
        });
      }

      const query = { _id: id(jobId) };

      if (req.user.role !== "admin") {
        query.recruiterId = getUserId(req.user);
      }

      const job = await jobs.findOne(query);

      if (!job) {
        return res.status(404).send({
          success: false,
          message: "Job not found or unauthorized",
        });
      }

      const result = await applications
        .find({ jobId: String(jobId) })
        .sort({ appliedAt: -1 })
        .toArray();

      res.send({
        success: true,
        jobTitle: job.title,
        totalApplicants: result.length,
        applicants: result,
      });
    } catch (error) {
      console.error("Get Applicants Error:", error);

      res.status(500).send({
        success: false,
        message: "Failed to fetch applicants",
      });
    }
  }
);

// Review Application

app.patch(
  "/applications/:id/review",
  verifyToken,
  verifyRecruiterOrAdmin,
  async (req, res) => {
    try {
      const { id: applicationId } = req.params;
      const { status } = req.body;

      if (
        !validId(applicationId) ||
        !["Shortlisted", "Rejected"].includes(status)
      ) {
        return res.status(400).send({
          success: false,
          message: "Invalid review data",
        });
      }

      const application = await applications.findOne({
        _id: id(applicationId),
      });

      if (!application) {
        return res.status(404).send({
          success: false,
          message: "Application not found",
        });
      }

      if (!validId(application.jobId)) {
        return res.status(400).send({
          success: false,
          message: "Invalid job reference",
        });
      }

      const jobQuery = { _id: id(application.jobId) };

      if (req.user.role !== "admin") {
        jobQuery.recruiterId = getUserId(req.user);
      }

      const job = await jobs.findOne(jobQuery);

      if (!job) {
        return res.status(403).send({
          success: false,
          message: "You are not authorized to review this application",
        });
      }

      await applications.updateOne(
        { _id: id(applicationId) },
        {
          $set: {
            status,
            reviewedAt: new Date(),
          },
        }
      );

      res.send({
        success: true,
        message: `Application ${status.toLowerCase()} successfully`,
      });
    } catch (error) {
      console.error("Review Application Error:", error);

      res.status(500).send({
        success: false,
        message: "Failed to review application",
      });
    }
  }
);


// Update Job

app.put(
  "/jobs/:id",
  verifyToken,
  verifyRecruiterOrAdmin,
  async (req, res) => {
    try {
      if (!validId(req.params.id)) {
        return res.status(400).send({
          message: "Invalid ID",
        });
      }

      const filter = { _id: id(req.params.id) };

      if (req.user.role !== "admin") {
        filter.recruiterId = getUserId(req.user);
      }

      const {
        title,
        company,
        category,
        jobType,
        workplace,
        location,
        salary,
        deadline,
        description,
        requirements,
        status,
      } = req.body;

      const result = await jobs.updateOne(filter, {
        $set: {
          title,
          company,
          category,
          jobType,
          workplace,
          location,
          salary,
          deadline,
          description,
          requirements,
          status,
        },
      });

      if (!result.matchedCount) {
        return res.status(404).send({
          success: false,
          message: "Job not found or unauthorized",
        });
      }

      res.send({
        success: true,
        message: "Job updated successfully",
      });
    } catch (error) {
      console.error("Update Job Error:", error);

      res.status(500).send({
        message: "Failed to update job",
      });
    }
  }
);

// Delete Job

app.delete(
  "/jobs/:id",
  verifyToken,
  verifyRecruiterOrAdmin,
  async (req, res) => {
    try {
      if (!validId(req.params.id)) {
        return res.status(400).send({
          message: "Invalid ID",
        });
      }

      const filter = { _id: id(req.params.id) };

      if (req.user.role !== "admin") {
        filter.recruiterId = getUserId(req.user);
      }

      const result = await jobs.deleteOne(filter);

      if (!result.deletedCount) {
        return res.status(404).send({
          success: false,
          message: "Job not found or unauthorized",
        });
      }

      res.send({
        success: true,
        message: "Job deleted successfully",
      });
    } catch (error) {
      console.error("Delete Job Error:", error);

      res.status(500).send({
        message: "Failed to delete job",
      });
    }
  }
);


// Applications
app.post(
  "/applications",
  verifyToken,
  verifySeeker,
  async (req, res) => {
    try {
      const data = req.body;
      const applicantEmail = req.user.email.trim();

      if (!applicantEmail || !validId(data.jobId)) {
        return res.status(400).send({
          message: "Invalid application data",
        });
      }

      const emailRegex = new RegExp(
        `^${applicantEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      );

      const existingApplication = await applications.findOne({
        jobId: String(data.jobId),
        applicantEmail: emailRegex,
      });

      if (existingApplication) {
        return res.status(409).send({
          message: "You have already applied for this job.",
        });
      }

      const count = await applications.countDocuments({
        applicantEmail: emailRegex,
      });

      const user = await users.findOne({
        email: emailRegex,
      });

      if (!user?.premium && count >= 10) {
        return res.status(403).send({
          message: "Limit reached",
        });
      }

      const job = await jobs.findOne({
        _id: id(data.jobId),
      });

      if (!job) {
        return res.status(404).send({
          message: "Job not found",
        });
      }

      const result = await applications.insertOne({
        ...data,
        applicantEmail,
        jobId: String(data.jobId),
        jobTitle: job.title,
        company: job.company,
        status: "Pending",
        appliedAt: new Date(),
      });

      await jobs.updateOne(
        { _id: id(data.jobId) },
        { $inc: { applications: 1 } }
      );

      res.status(201).send({
        success: true,
        message: "Application submitted successfully",
        insertedId: result.insertedId,
      });
    } catch (error) {
      console.error("Application Error:", error);

      res.status(500).send({
        message: "Failed to apply",
      });
    }
  }
);


// Get Applications
app.get("/applications", async (req, res) => {
  try {
    const query = req.query.email
      ? { applicantEmail: req.query.email }
      : {};

    const result = await applications
      .find(query)
      .sort({ appliedAt: -1 })
      .toArray();

    const data = await Promise.all(
      result.map(async (item) => {
        const job = validId(item.jobId)
          ? await jobs.findOne({ _id: id(item.jobId) })
          : null;

        return {
          ...item,
          jobTitle: job?.title || item.jobTitle || "Job not available",
          company: job?.company || item.company || "Unknown company",
        };
      })
    );

    res.send(data);
  } catch (error) {
    console.error("Get Applications Error:", error);

    res.status(500).send({
      message: "Failed to get applications",
    });
  }
});

// Get Single Application
app.get("/applications/:id", async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).send("Invalid ID");
    }

    const result = await applications.findOne({
      _id: id(req.params.id),
    });

    if (!result) {
      return res.status(404).send({
        message: "Application not found",
      });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to get application",
    });
  }
});

// Delete Application
app.delete("/applications/:id", async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).send("Invalid ID");
    }

    const result = await applications.deleteOne({
      _id: id(req.params.id),
    });

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to delete application",
    });
  }
});

// Saved Jobs
app.post("/saved-jobs", async (req, res) => {
  try {
    const { email, jobId } = req.body;

    if (!email || !validId(jobId)) {
      return res.status(400).send("Invalid data");
    }

    const existing = await savedJobs.findOne({
      email,
      jobId,
    });

    if (existing) {
      return res.status(409).send("Already saved");
    }

    const result = await savedJobs.insertOne({
      email,
      jobId,
      savedAt: new Date(),
    });

    res.send(result);
  } catch (error) {
    console.error("Save Job Error:", error);

    res.status(500).send({
      message: "Failed to save job",
    });
  }
});

// Get Saved Jobs
app.get("/saved-jobs", async (req, res) => {
  try {
    const list = await savedJobs
      .find({ email: req.query.email })
      .toArray();

    const result = await Promise.all(
      list.map(async (item) => {
        if (!validId(item.jobId)) return null;

        const job = await jobs.findOne({
          _id: id(item.jobId),
        });

        return job ? { ...job, savedId: item._id } : null;
      })
    );

    res.send(result.filter(Boolean));
  } catch (error) {
    res.status(500).send({
      message: "Failed to get saved jobs",
    });
  }
});

// Delete Saved Job
app.delete("/saved-jobs/:id", async (req, res) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).send("Invalid ID");
    }

    const result = await savedJobs.deleteOne({
      _id: id(req.params.id),
    });

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to delete saved job",
    });
  }
});

// Users - Admin Only
app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await users
      .find({})
      .project({ password: 0 })
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to get users",
    });
  }
});

// Get Single User
app.get("/users/:email", verifyToken, async (req, res) => {
  try {
    const requestedEmail = req.params.email;

    const isAdmin = req.user.role === "admin";
    const isOwnProfile =
      req.user.email?.toLowerCase() === requestedEmail.toLowerCase();

    if (!isAdmin && !isOwnProfile) {
      return res.status(403).send({
        success: false,
        message: "Access denied",
      });
    }

    const result = await users.findOne(
      { email: requestedEmail },
      { projection: { password: 0 } }
    );

    if (!result) {
      return res.status(404).send({
        message: "User not found",
      });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to get user",
    });
  }
});

// Payments - Verify Checkout
app.post(
  "/payments/checkout-verify",
  verifyToken,
  async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).send({
        success: false,
        message: "Session ID is required",
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (
      session.status !== "complete" ||
      session.payment_status !== "paid"
    ) {
      return res.status(400).send({
        success: false,
        message: "Payment verification failed",
      });
    }

    if (
      session.mode !== "subscription" ||
      session.currency !== "usd" ||
      !session.metadata?.userId
    ) {
      return res.status(400).send({
        success: false,
        message: "Invalid checkout session",
      });
    }

    const lineItems = await stripe.checkout.sessions.listLineItems(
      sessionId,
      { limit: 10 }
    );

    const correctPrice = lineItems.data.some(
      (item) =>
        item.price?.id === process.env.STRIPE_PRICE_ID &&
        item.quantity === 1
    );

    if (!correctPrice) {
      return res.status(400).send({
        success: false,
        message: "Invalid subscription price",
      });
    }

    const userId = session.metadata.userId;
    if (String(userId) !== getUserId(req.user)) {
  return res.status(403).send({
    success: false,
    message: "You cannot verify another user's payment",
  });
}

    if (!ObjectId.isValid(userId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid user information",
      });
    }

    const user = await users.findOne({
      _id: new ObjectId(userId),
    });

    if (!user) {
      return res.status(404).send({
        success: false,
        message: "User not found",
      });
    }

    const existingPayment = await payments.findOne({
      sessionId,
    });

    if (existingPayment) {
      return res.send({
        success: true,
        message: "Payment already verified",
      });
    }

    await payments.insertOne({
      sessionId,
      userId,
      customer_email:
        session.customer_details?.email || session.customer_email,
      customer_name: session.customer_details?.name,
      amount: session.amount_total,
      currency: session.currency,
      payment_status: session.payment_status,
      payment_date: new Date(session.created * 1000),
      payment_intent: session.payment_intent,
      subscriptionId: session.subscription,
      createdAt: new Date(),
    });

    await users.updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          premium: true,
          plan: "premium",
        },
      }
    );

    res.send({
      success: true,
      message: "Premium activated successfully",
    });
  } catch (error) {
    console.error("Payment Verification Error:", error);

    res.status(500).send({
      success: false,
      message: "Payment verification failed",
    });
  }
});

// Get All Payments - Admin Only
app.get(
  "/payments",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const result = await payments
        .find()
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Failed to get payments",
      });
    }
  }
);

// Server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`HireLoop server is running on port ${PORT}`);
});
