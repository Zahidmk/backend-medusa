import { Module } from "@medusajs/framework/utils"
import ReturnRequestService from "./service"

export const RETURN_REQUEST_MODULE = "return_request"

export default Module(RETURN_REQUEST_MODULE, {
  service: ReturnRequestService,
})
