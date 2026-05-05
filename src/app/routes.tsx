import { createBrowserRouter } from "react-router";
import { LoginPage } from "./components/LoginPage";
import { SignUpPage } from "./components/SignUpPage";
import { DoctorDashboard } from "./components/DoctorDashboard";
import { PatientApp } from "./components/PatientApp";
import { LandingNav } from "./components/LandingNav";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: LandingNav,
    children: [
      { index: true, Component: LoginPage },
      { path: "signup", Component: SignUpPage },
      { path: "doctor", Component: DoctorDashboard },
      { path: "patient", Component: PatientApp },
    ],
  },
]);
