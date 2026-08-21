const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./models/User');
const Message = require('./models/Message');

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
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

// টেস্ট রুট
app.get('/', (req, res) => {
    res.send("Say Chat App Backend is running!");
});

// ১. ইউজার রেজিস্ট্রেশন (Sign Up) API
app.post('/api/register', async (req, res) => {
    try {
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
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "User not found with this email" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid password" });
        }

        res.status(200).json({ 
            message: "Login Successful", 
            username: user.username,
            email: user.email 
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// ৩. সব ইউজারের তালিকা পাওয়ার API
app.get('/api/users/:email', async (userReq, userRes) => {
    try {
        const currentEmail = userReq.params.email;
        const users = await User.find({ email: { $ne: currentEmail } }).select('username email');
        userRes.status(200).json(users);
    } catch (error) {
        userRes.status(500).json({ message: "Server error", error: error.message });
    }
});

// ৪. পুরোনো চ্যাট হিস্ট্রি দেখার API
app.get('/api/messages/:user1/:user2', async (req, res) => {
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