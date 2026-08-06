import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import KnetPaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [KnetPaymentProviderService],
})
