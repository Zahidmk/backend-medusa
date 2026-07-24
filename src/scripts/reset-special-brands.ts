import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function resetSpecialBrands({ container }: ExecArgs) {
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any

  console.log("Resetting all brands to is_special = false...")
  const result = await pgConnection.raw(`UPDATE brand SET is_special = false, updated_at = NOW()`)
  console.log("Database update result:", result.rowCount ?? result.rows?.length ?? "done")
  console.log("All brands have been reset to non-special.")
}
