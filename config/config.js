const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const uri = process.env.MONGO_URI;

        if (!uri) {
            throw new Error('MONGO_URI environment variable is not defined');
        }

        await mongoose.connect(uri);
        console.log('MongoDB connected!');
    } catch (error) {
        console.error('MongoDB connection failed:', error.message);
        process.exit(1);
    }
};

module.exports = connectDB;
