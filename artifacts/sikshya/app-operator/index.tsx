import { Redirect } from "expo-router";

/** A named public route avoids the /(admin)/index and / index URL collision. */
export default function OperatorEntry() {
  return <Redirect href={"/login" as never} />;
}
