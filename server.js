const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const User = require('./models/User');
const Message = require('./models/Message');

const app = express();

app.use(cors({
    origin: "https://say-chat-frontend.vercel.app",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "https://say-chat-frontend.vercel.app",
        methods: ["GET", "POST"]
    }
});

// MongoDB ডেটাবেজ কানেকশন
mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log("MongoDB Connected Successfully for 'Say' App!");
})
.catch((err) => {
    console.log("Database Connection Failed: ", err);
});

// লগইন/রেজিস্ট্রেশনের জন্য Rate Limiter
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // ১৫ মিনিট
    max: 20, // সর্বোচ্চ ২০ বার চেষ্টা
    message: { message: "Too many attempts. Please try again after 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});

// টেস্ট রুট
app.get('/', (req, res) => {
    res.send("Say Chat App Backend is running!");
});

// ১. ইউজার রেজিস্ট্রেশন (Sign Up) API
app.post('/api/register',
    authLimiter,
    [
        body('username').trim().notEmpty().withMessage('Username is required'),
        body('email').isEmail().withMessage('Please enter a valid email'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    ],
    async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array()[0].msg });
        }

        const { username, email, password } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "This email is already registered!" });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            username,
            email,
            password: hashedPassword
        });

        await newUser.save();
        res.status(201).json({ message: "User registered successfully!" });

    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// ২. ইউজার লগইন (Login) API
app.post('/api/login',
    authLimiter,
    [
        body('email').isEmail().withMessage('Please enter a valid email'),
        body('password').notEmpty().withMessage('Password is required')
    ],
    async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array()[0].msg });
        }

        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "User not found with this email" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid password" });
        }

        const token = jwt.sign(
            { email: user.email, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(200).json({ 
            message: "Login Successful", 
            username: user.username,
            email: user.email,
            token: token
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// টোকেন যাচাই করার Middleware
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Access denied. No token provided." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ message: "Invalid or expired token." });
    }
};

// ৩. সব ইউজারের তালিকা পাওয়ার API
app.get('/api/users/:email', verifyToken, async (userReq, userRes) => {
    try {
        const currentEmail = userReq.params.email;
        const users = await User.find({ email: { $ne: currentEmail } }).select('username email');
        userRes.status(200).json(users);
    } catch (error) {
        userRes.status(500).json({ message: "Server error", error: error.message });
    }
});

// ৪. পুরোনো চ্যাট হিস্ট্রি দেখার API
app.get('/api/messages/:user1/:user2', verifyToken, async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        const messages = await Message.find({
            $or: [
                { sender: user1, receiver: user2 },
                { sender: user2, receiver: user1 }
            ]
        }).sort({ timestamp: 1 });
        res.status(200).json(messages);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// সোকেট.আইও রিয়েল-টাইম চ্যাট লজিক
io.on('connection', (socket) => {
    console.log("A user connected to Say: " + socket.id);

    socket.on('join_room', (email) => {
        socket.join(email);
        console.log(`User joined room: ${email}`);
    });

    socket.on('send_message', async (data) => {
        try {
            const { sender, receiver, message } = data;

            const newMessage = new Message({ sender, receiver, message });
            await newMessage.save();

            io.to(receiver).emit('receive_message', newMessage);
        } catch (error) {
            console.log("Error saving message: ", error);
        }
    });

    socket.on('disconnect', () => {
        console.log("A user disconnected from Say");
    });
});

const PORT = process.env.PORT || 5007;
server.listen(PORT, () => {
    console.log(`Say Server is running on port ${PORT}`);
});