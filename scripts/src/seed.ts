import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@workspace/db/schema";
import { sql } from "drizzle-orm";

// Replit injected DATABASE_URL into the environment automatically. Running anywhere else,
// it comes from the .env file at the repo root instead.
if (!process.env.DATABASE_URL) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  try {
    process.loadEnvFile(path.join(here, "../../.env"));
  } catch {
    // No .env file — the clearer error below covers it.
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Create a .env file at the repo root containing DATABASE_URL=...",
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

const DISTRICTS = [
  { district: "Kathmandu", location: "Kathmandu" },
  { district: "Lalitpur", location: "Lalitpur" },
  { district: "Bhaktapur", location: "Bhaktapur" },
  { district: "Kaski", location: "Pokhara" },
  { district: "Chitwan", location: "Chitwan" },
  { district: "Morang", location: "Biratnagar" },
  { district: "Sunsari", location: "Dharan" },
  { district: "Rupandehi", location: "Butwal" },
  { district: "Jhapa", location: "Birtamod" },
  { district: "Ilam", location: "Ilam" },
  { district: "Parsa", location: "Birgunj" },
  { district: "Sarlahi", location: "Malangwa" },
  { district: "Kailali", location: "Dhangadhi" },
  { district: "Banke", location: "Nepalgunj" },
  { district: "Dang", location: "Tulsipur" },
  { district: "Mahottari", location: "Jaleshwar" },
  { district: "Solukhumbu", location: "Salleri" },
  { district: "Mustang", location: "Jomsom" },
  { district: "Doti", location: "Dipayal" },
  { district: "Humla", location: "Simikot" },
];

const SUBJECTS = [
  { subject: "Mathematics", subs: ["Algebra", "Calculus", "Statistics", "Geometry", "Trigonometry", "Arithmetic"] },
  { subject: "Science", subs: ["Physics", "Chemistry", "Biology", "Environmental Science"] },
  { subject: "English", subs: ["Grammar", "Literature", "Spoken English", "IELTS Preparation", "Writing"] },
  { subject: "Nepali", subs: ["Nepali Literature", "Grammar", "Essay Writing", "Poetry Analysis"] },
  { subject: "Computer Science", subs: ["Programming", "Web Development", "Database", "Python", "JavaScript", "Algorithms"] },
  { subject: "History", subs: ["Ancient History", "Modern Nepal", "World History", "Social Studies"] },
  { subject: "Geography", subs: ["Physical Geography", "Human Geography", "Nepal Geography", "Cartography"] },
  { subject: "Economics", subs: ["Microeconomics", "Macroeconomics", "Development Economics", "Statistics"] },
];

const FIRST_NAMES = [
  "Ram", "Shyam", "Hari", "Krishna", "Bishnu", "Gopal", "Sita", "Gita", "Sunita", "Anita",
  "Priya", "Meena", "Kamala", "Sarita", "Mina", "Kiran", "Arun", "Bijay", "Dipak", "Roshan",
  "Suresh", "Mahesh", "Rajesh", "Ganesh", "Ramesh", "Sanjay", "Prakash", "Naresh", "Umesh", "Dinesh",
  "Anjali", "Rekha", "Ritu", "Nisha", "Pooja", "Manisha", "Sangita", "Bimala", "Puspa", "Sumitra",
  "Tek", "Bal", "Dhan", "Man", "Lal", "Devi", "Maya", "Puja", "Kumari", "Laxmi",
  "Santosh", "Amrit", "Bikram", "Suman", "Subash", "Nabin", "Prabin", "Sandip", "Sagar", "Sujan",
  "Deepa", "Shanta", "Parbati", "Radha", "Durga", "Saraswati", "Mandira", "Binita", "Babita", "Kabita",
  "Raj", "Dev", "Shiva", "Mohan", "Narayan", "Prem", "Basanta", "Hemanta", "Siddhant", "Abhinav",
  "Shreya", "Priyanka", "Bhawana", "Sabina", "Rubina", "Alina", "Kritika", "Srijana", "Pramila", "Usha",
  "Binod", "Kamal", "Tanka", "Mukesh", "Sushil", "Nirmal", "Bidur", "Shankar", "Bhuwan", "Tilak",
];

const LAST_NAMES = [
  "Sharma", "Thapa", "Rai", "Gurung", "Tamang", "Magar", "Karki", "Shrestha", "Poudel", "Adhikari",
  "Acharya", "Pandey", "Bhandari", "Chaudhary", "Bhattarai", "Sapkota", "Dahal", "Lamsal", "Koirala", "Regmi",
  "Basnet", "Subedi", "Neupane", "Upreti", "Khanal", "Luitel", "Dhakal", "Tiwari", "Joshi", "Mainali",
  "Pokhrel", "Giri", "Parajuli", "Ghimire", "Rijal", "Gautam", "Silwal", "Oli", "Deuja", "Baral",
  "Hamal", "Bohara", "Khatri", "Bista", "Chand", "Roka", "Saud", "Thakuri", "Shahi", "Kunwar",
  "KC", "Bishwakarma", "Pariyar", "Sunar", "Saru", "Lama", "Sherpa", "Limbu", "Yonzon", "Sunuwar",
];

const SESSION_TOPICS: Record<string, string[]> = {
  Mathematics: [
    "Introduction to Calculus", "Derivatives and Applications", "Integration Techniques",
    "Linear Algebra Basics", "Matrix Operations", "Statistics and Probability",
    "Trigonometric Identities", "Complex Numbers", "Differential Equations", "Number Theory",
    "Quadratic Equations", "Sequences and Series", "Vectors in 3D", "Set Theory Fundamentals",
    "Permutations and Combinations", "Coordinate Geometry", "Functions and Graphs",
  ],
  Science: [
    "Newton's Laws of Motion", "Laws of Thermodynamics", "Electricity and Magnetism",
    "Wave Optics", "Atomic Structure", "Chemical Bonding", "Organic Chemistry Basics",
    "Cell Biology", "Genetics and Heredity", "Photosynthesis", "Human Physiology",
    "Environmental Pollution", "Ecosystem Dynamics", "Nuclear Physics", "Quantum Mechanics Intro",
  ],
  English: [
    "Essay Writing Techniques", "IELTS Reading Strategies", "Grammar: Tenses Masterclass",
    "Spoken English Fluency", "Vocabulary Building", "Reading Comprehension",
    "Listening Skills for IELTS", "Academic Writing Task 1", "Academic Writing Task 2",
    "Common Errors in English", "Prepositions and Articles", "Phrasal Verbs",
  ],
  Nepali: [
    "Nepali Vyakaran Mool Sidhanta", "Nibandha Lekhan", "Kavita Bisleshan",
    "Gadya ra Padya", "Katha Sahitya", "Alankar ra Chhanda",
    "Nepali Sahityako Itihas", "Sambad Lekhan", "Patra Lekhan", "Bhasha ra Boli",
  ],
  "Computer Science": [
    "Python Programming Fundamentals", "Data Structures and Algorithms",
    "Web Development with HTML/CSS", "JavaScript for Beginners", "Database Design with SQL",
    "Object Oriented Programming", "RESTful API Design", "Git and Version Control",
    "React.js Basics", "Node.js Backend Development", "Networking Fundamentals",
    "Cybersecurity Essentials", "Machine Learning Introduction",
  ],
  History: [
    "Ancient Civilizations of Nepal", "Unification of Nepal by Prithvi Narayan Shah",
    "Rana Regime and Democracy Movement", "Modern Nepalese History",
    "World War I and II Causes", "Rise of Nationalism", "Colonial History of Asia",
    "Nepal's Foreign Relations", "Democratic Movements", "2015 Constitution of Nepal",
  ],
  Geography: [
    "Physical Features of Nepal", "Climate Zones of Nepal", "River Systems",
    "Population Distribution", "Economic Geography", "Map Reading and GIS",
    "Human Geography Concepts", "Himalayan Ecology", "Natural Disasters and Preparedness",
    "Urbanization Trends", "Agricultural Geography",
  ],
  Economics: [
    "Supply and Demand Analysis", "Macroeconomic Indicators", "Nepal's Development Plans",
    "Monetary Policy", "Fiscal Policy and Taxation", "International Trade",
    "Development Economics", "Microeconomic Theory", "Consumer Behaviour",
    "Market Structures", "Agricultural Economics in Nepal",
  ],
};

const REVIEW_COMMENTS = [
  "Excellent teacher! Concepts explained very clearly.",
  "Very helpful and patient. Highly recommended.",
  "Great teaching style, easy to understand.",
  "Wonderful session, learned a lot today.",
  "Very knowledgeable and professional.",
  "Best teacher I have had for this subject.",
  "Session was very interactive and engaging.",
  "Clear explanations with good examples.",
  "My doubts were resolved very quickly.",
  "Highly recommend to all students.",
  "Very thorough and systematic approach to teaching.",
  "Excellent command over the subject matter.",
  "The teacher made complex topics simple.",
  "I improved my grade significantly after joining.",
  "Very punctual and well-prepared for every session.",
  "Amazing teaching methodology. Worth every rupee.",
  "The teacher is very supportive and encouraging.",
  "Good session, could be slightly more interactive.",
  "Decent teacher, explains concepts step by step.",
  "Nice session overall, looking forward to the next one.",
  "Average session. Could improve on engagement.",
  "Teacher is knowledgeable but sessions need more practice problems.",
  "Good content but slightly rushed at times.",
  "Helpful session but explanations could be simpler.",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 1): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

async function main() {
  console.log("🌱 Clearing existing seeded data...");
  await db.execute(sql`DELETE FROM reviews`);
  await db.execute(sql`DELETE FROM session_enrollments`);
  await db.execute(sql`DELETE FROM sessions`);
  await db.execute(sql`DELETE FROM teacher_profiles`);
  await db.execute(sql`DELETE FROM student_profiles`);
  await db.execute(sql`DELETE FROM users`);
  console.log("✅ Cleared.");

  const passwordHash = await hashPassword("password123");

  console.log("👩‍🏫 Creating 200 teachers...");
  const TEACHER_COUNT = 200;
  const teacherUserIds: number[] = [];

  for (let i = 0; i < TEACHER_COUNT; i++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const name = `${firstName} ${lastName}`;
    const email = `teacher${i + 1}@sikshya.np`;
    const subjectData = pick(SUBJECTS);
    const locData = pick(DISTRICTS);
    const experienceYears = randInt(2, 20);
    const pricePerSession = randInt(2, 12) * 50; // 100–600 NPR
    const totalStudents = randInt(5, 150);
    const reviewCount = randInt(5, 300);
    const rating = randFloat(3.5, 5.0, 1);
    const sessionsThisMonth = randInt(0, 10);
    const isApproved = i < 190; // first 190 are approved, last 10 pending
    const isOnline = Math.random() > 0.4;
    const langChoices = ["Nepali", "English", "Hindi", "Maithili", "Bhojpuri", "Limbu", "Tamang", "Newari"];
    const languages = ["Nepali", ...pickN(langChoices.slice(1), randInt(0, 2))];
    const subjects = pickN(subjectData.subs, randInt(2, Math.min(4, subjectData.subs.length)));
    const monthlyEarnings = sessionsThisMonth * pricePerSession * randInt(3, 12);

    const bios = [
      `${name} is a dedicated ${subjectData.subject} teacher from ${locData.location} with ${experienceYears} years of experience. Specializes in ${subjects[0]} and ${subjects[1] ?? subjects[0]}.`,
      `Experienced ${subjectData.subject} educator based in ${locData.location}. Former lecturer with ${experienceYears} years of teaching experience. Passionate about student success.`,
      `${subjectData.subject} teacher from ${locData.location} helping students master ${subjects[0]}. ${experienceYears} years of teaching experience at secondary and higher secondary level.`,
      `Dedicated to making ${subjectData.subject} accessible and enjoyable. Based in ${locData.location} with ${experienceYears} years of experience and ${totalStudents} students taught.`,
    ];

    const [user] = await db.insert(schema.usersTable).values({
      name, email, role: "teacher", passwordHash,
    }).returning();

    await db.insert(schema.teacherProfilesTable).values({
      userId: user.id,
      subject: subjectData.subject,
      subjects,
      bio: pick(bios),
      approvalStatus: isApproved ? "approved" : "pending",
      location: locData.location,
      district: locData.district,
      experienceYears,
      pricePerSession,
      languages,
      isOnline,
      subscriptionActive: isApproved,
      sessionsThisMonth,
      totalStudents,
      monthlyEarnings,
      rating,
      reviewCount,
    });

    teacherUserIds.push(user.id);

    if ((i + 1) % 50 === 0) console.log(`  Created ${i + 1} teachers...`);
  }

  // Named demo teachers (overwrite first 8 with familiar names)
  const demoTeachers = [
    { name: "Ram Prasad Sharma", email: "ram@example.com", subject: "Mathematics", subjects: ["Algebra", "Calculus", "Statistics"], location: "Kathmandu", district: "Kathmandu", exp: 15, price: 500, students: 45, reviews: 124, rating: 4.8, online: true },
    { name: "Sunita Thapa", email: "sunita@example.com", subject: "Science", subjects: ["Physics", "Chemistry", "Biology"], location: "Lalitpur", district: "Lalitpur", exp: 11, price: 450, students: 32, reviews: 89, rating: 4.6, online: false },
    { name: "Bishnu Bahadur Rai", email: "bishnu@example.com", subject: "English", subjects: ["Grammar", "Literature", "Spoken English", "IELTS Preparation"], location: "Pokhara", district: "Kaski", exp: 12, price: 600, students: 67, reviews: 203, rating: 4.9, online: true },
    { name: "Priya Acharya", email: "priya@example.com", subject: "Nepali", subjects: ["Nepali Literature", "Grammar", "Essay Writing"], location: "Bhaktapur", district: "Bhaktapur", exp: 8, price: 350, students: 28, reviews: 56, rating: 4.5, online: false },
    { name: "Kiran Tamang", email: "kiran@example.com", subject: "Computer Science", subjects: ["Programming", "Web Development", "Python"], location: "Chitwan", district: "Chitwan", exp: 8, price: 550, students: 54, reviews: 142, rating: 4.7, online: true },
  ];

  for (const d of demoTeachers) {
    const [user] = await db.insert(schema.usersTable).values({
      name: d.name, email: d.email, role: "teacher", passwordHash,
    }).returning();
    await db.insert(schema.teacherProfilesTable).values({
      userId: user.id,
      subject: d.subject,
      subjects: d.subjects,
      bio: `${d.name} is an experienced ${d.subject} teacher from ${d.location} with ${d.exp} years of experience.`,
      approvalStatus: "approved",
      location: d.location,
      district: d.district,
      experienceYears: d.exp,
      pricePerSession: d.price,
      languages: ["Nepali", "English"],
      isOnline: d.online,
      subscriptionActive: true,
      sessionsThisMonth: randInt(3, 9),
      totalStudents: d.students,
      monthlyEarnings: d.students * d.price,
      rating: d.rating,
      reviewCount: d.reviews,
    });
    teacherUserIds.push(user.id);
  }
  console.log("✅ Teachers created.");

  console.log("🎓 Creating 500 student users...");
  const studentUserIds: number[] = [];
  for (let i = 0; i < 500; i++) {
    const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const [user] = await db.insert(schema.usersTable).values({
      name, email: `student${i + 1}@sikshya.np`, role: "student", passwordHash,
    }).returning();
    await db.insert(schema.studentProfilesTable).values({
      userId: user.id,
      grade: pick(["Grade 9", "Grade 10", "Grade 11", "Grade 12", "+2 Science", "+2 Management", "+2 Humanities"]),
    });
    studentUserIds.push(user.id);
  }
  // Demo student
  const [demoStudent] = await db.insert(schema.usersTable).values({
    name: "Aarav Shrestha", email: "student@sikshya.np", role: "student", passwordHash,
  }).returning();
  await db.insert(schema.studentProfilesTable).values({ userId: demoStudent.id, grade: "Grade 11" });
  studentUserIds.push(demoStudent.id);
  console.log("✅ Students created.");

  console.log("📅 Creating sessions...");
  let totalSessions = 0;
  const allTeacherProfiles = await db.select().from(schema.teacherProfilesTable);
  for (const profile of allTeacherProfiles) {
    if (profile.approvalStatus !== "approved") continue;
    const [userRow] = await db.select({ name: schema.usersTable.name })
      .from(schema.usersTable).where(sql`id = ${profile.userId}`);
    const subjectData = SUBJECTS.find((s) => s.subject === profile.subject) ?? SUBJECTS[0];
    const topics = SESSION_TOPICS[profile.subject] ?? SESSION_TOPICS.Mathematics;
    const sessionCount = randInt(3, 12);
    for (let j = 0; j < sessionCount; j++) {
      const daysOffset = randInt(-60, 21); // past 60 days to 3 weeks ahead
      const sessionDate = new Date();
      sessionDate.setDate(sessionDate.getDate() + daysOffset);
      sessionDate.setHours(randInt(8, 19), randInt(0, 1) * 30, 0, 0);
      const status = daysOffset < -1 ? "completed" : daysOffset < 0 ? "live" : "upcoming";
      const enrolled = randInt(0, Math.min(15, profile.totalStudents));
      await db.insert(schema.sessionsTable).values({
        teacherId: profile.userId,
        teacherName: userRow?.name ?? "Teacher",
        subject: profile.subject,
        topic: pick(topics),
        date: sessionDate,
        duration: pick([45, 60, 90]),
        maxStudents: randInt(10, 20),
        enrolledCount: enrolled,
        price: profile.pricePerSession ?? 400,
        status,
      });
      totalSessions++;
    }
  }
  console.log(`✅ Created ${totalSessions} sessions.`);

  console.log("⭐ Creating reviews...");
  let totalReviews = 0;
  for (const profile of allTeacherProfiles) {
    if (profile.approvalStatus !== "approved" || profile.reviewCount === 0) continue;
    const count = Math.min(profile.reviewCount, 50); // seed up to 50 reviews per teacher
    for (let r = 0; r < count; r++) {
      const ratingBias = profile.rating;
      const rating = Math.max(1, Math.min(5,
        Math.round((ratingBias + randFloat(-0.8, 0.8)) * 2) / 2
      ));
      const studentId = pick(studentUserIds);
      const studentName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - randInt(0, 180));
      await db.insert(schema.reviewsTable).values({
        teacherId: profile.userId,
        studentId,
        studentName,
        rating,
        comment: pick(REVIEW_COMMENTS),
        createdAt,
      });
      totalReviews++;
    }
  }
  console.log(`✅ Created ${totalReviews} reviews.`);

  console.log("\n🎉 Seed complete!");
  console.log(`   Teachers: ${allTeacherProfiles.length}`);
  console.log(`   Students: 501`);
  console.log(`   Sessions: ${totalSessions}`);
  console.log(`   Reviews:  ${totalReviews}`);
  console.log("\n📧 Demo logins (password: password123):");
  console.log("   Teacher: ram@example.com / password123");
  console.log("   Student: student@sikshya.np / password123");

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
