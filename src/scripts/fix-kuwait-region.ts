import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function fixKuwaitRegion({ container }: ExecArgs) {
  const regionService = container.resolve(Modules.REGION)
  const regions = await regionService.listRegions({}, { relations: ["countries"] })
  
  const kuwaitRegion = regions.find(r => r.name.toLowerCase().includes("kuwait") || r.currency_code === "kwd")
  
  if (kuwaitRegion) {
    console.log(`Found region: ${kuwaitRegion.name}, Countries: ${kuwaitRegion.countries?.map(c => c.iso_2).join(',')}`)
    const countryCodes = kuwaitRegion.countries?.map(c => c.iso_2) || []
    if (!countryCodes.includes('kw')) {
      console.log('Adding kw country to region...')
      await regionService.updateRegions(kuwaitRegion.id, {
        countries: [...countryCodes, 'kw']
      })
      console.log('Added kw country to region successfully!')
    } else {
      console.log('kw already in region.')
    }
  } else {
    console.log('No Kuwait region found.')
  }
}
