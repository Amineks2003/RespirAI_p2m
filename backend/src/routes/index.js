import express from "express";
import { authRouter } from "./auth.routes.js";
import { doctorRouter } from "./doctor.routes.js";
import { patientRouter } from "./patient.routes.js";

export const apiRouter = express.Router();

apiRouter.get("/", (_req, res) => {
  res.json({
    success: true,
    service: "ehealth-backend-api",
    version: "1.0.0",
    endpoints: ["/api/auth", "/api/doctor", "/api/patient"],
  });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/doctor", doctorRouter);
apiRouter.use("/patient", patientRouter);
