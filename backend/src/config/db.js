import mongoose from "mongoose";

export const connectDatabase = async (uri) => {
  if (!uri) {
    throw new Error("MONGODB_URI is not defined in environment variables");
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);

  console.log("✅ MongoDB connected");
};
