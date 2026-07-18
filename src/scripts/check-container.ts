import { ExecArgs } from "@medusajs/framework/types";

export default async function ({ container }: ExecArgs) {
  const registrations = (container as any).registrations;
  console.log(registrations ? Object.keys(registrations).sort() : "No registrations property");
}
