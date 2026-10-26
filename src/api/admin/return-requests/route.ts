import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { RETURN_REQUEST_MODULE } from "../../../modules/return-request"

// GET /admin/return-requests?status=requested
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const svc = req.scope.resolve(RETURN_REQUEST_MODULE) as any
  const filter: any = {}
  const status = (req.query?.status as string | undefined)?.trim()
  if (status) filter.status = status
  const [requests, count] = await svc.listAndCountReturnRequests(filter, { take: 200, order: { created_at: "DESC" } })
  res.json({ requests, count })
}
