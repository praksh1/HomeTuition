import React from "react";
import { createRoot } from "react-dom/client";
import Register from "../../app/(auth)/register";
import CheckEmail from "../../app/check-email";
const query = new URLSearchParams(window.location.search);
createRoot(document.getElementById("root")!).render(query.has("verify") ? <CheckEmail /> : <Register />);
