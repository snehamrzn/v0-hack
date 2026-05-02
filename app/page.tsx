"use client";
import App from "../components/App";
import { Agentation } from "agentation";

export default function Page() {
  return (
    <>
      <App />
      {process.env.NODE_ENV === "development" && <Agentation />}
    </>
  );
}
