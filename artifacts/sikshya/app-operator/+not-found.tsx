import { Redirect } from "expo-router";
// A stale participant bookmark (including the old sign-out destination) never opens its login.
export default function OperatorNotFound() { return <Redirect href={"/login" as never} />; }
