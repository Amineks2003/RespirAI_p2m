import express from "express";
import cors from "cors";
import morgan from "morgan";
import { apiRouter } from "./routes/index.js";
import { notFoundHandler, errorHandler } from "./middlewares/errorHandler.js";

export const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ehealth-backend" });
});

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
