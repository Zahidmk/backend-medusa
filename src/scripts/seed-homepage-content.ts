import { ExecArgs, IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../modules/brands"
import { MEDIA_MODULE } from "../modules/media"

// Sample product images from Unsplash (free to use)
const PRODUCT_IMAGES = {
  phones: [
    "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1565849904461-04a58ad377e0?w=400&h=400&fit=crop",
  ],
  laptops: [
    "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400&h=400&fit=crop",
  ],
  headphones: [
    "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1484704849700-f032a568e944?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=400&h=400&fit=crop",
  ],
  watches: [
    "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=400&h=400&fit=crop",
  ],
  powerbanks: [
    "https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1585338447937-7082f8fc763d?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1626806819282-2c1dc01a5e0c?w=400&h=400&fit=crop",
  ],
  cameras: [
    "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1617005082133-548c4dd27f35?w=400&h=400&fit=crop",
  ],
  gaming: [
    "https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1593118247619-e2d6f056869e?w=400&h=400&fit=crop",
  ],
  accessories: [
    "https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1625895197185-efcec01cffe0?w=400&h=400&fit=crop",
  ],
}

// Brand logos (using local images from public/brands folder)
const BRAND_DATA = [
  { name: "Apple", slug: "apple", logo_url: "/brands/apple.svg" },
  { name: "Samsung", slug: "samsung", logo_url: "/brands/belkin.svg" },
  { name: "Sony", slug: "sony", logo_url: "/brands/guess.svg" },
  { name: "Xiaomi", slug: "xiaomi", logo_url: "/brands/lacoste.svg" },
  { name: "JBL", slug: "jbl", logo_url: "/brands/lepresso.svg" },
  { name: "Bose", slug: "bose", logo_url: "/brands/poroda.svg" },
  { name: "Anker", slug: "anker", logo_url: "/brands/us-polo.svg" },
  { name: "Logitech", slug: "logitech", logo_url: "/brands/apple-white.avif" },
]

// Hero banner images
const BANNER_DATA = [
  {
    title: "New iPhone 17 Pro",
    subtitle: "Experience the future of mobile technology",
    image_url: "https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?w=1200&h=500&fit=crop",
    link: "/categories/smart-phones",
  },
  {
    title: "Gaming Setup Sale",
    subtitle: "Up to 50% off on gaming accessories",
    image_url: "https://images.unsplash.com/photo-1593118247619-e2d6f056869e?w=1200&h=500&fit=crop",
    link: "/categories/gaming",
  },
  {
    title: "Premium Headphones",
    subtitle: "Immerse yourself in sound",
    image_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1200&h=500&fit=crop",
    link: "/categories/headphones",
  },
  {
    title: "Smart Watches Collection",
    subtitle: "Stay connected, stay stylish",
    image_url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1200&h=500&fit=crop",
    link: "/categories/smart-watches",
  },
]

// Product definitions for different collections
const APPLE_PRODUCTS = [
  { title: "iPhone 17 Pro Max 256GB", handle: "iphone-17-pro-max", price: 1199, category: "phones" },
  { title: "iPhone 17 Pro 128GB", handle: "iphone-17-pro", price: 999, category: "phones" },
  { title: "MacBook Pro 14-inch M4", handle: "macbook-pro-14", price: 1999, category: "laptops" },
  { title: "MacBook Air 13-inch M3", handle: "macbook-air-13", price: 1099, category: "laptops" },
  { title: "AirPods Pro 3rd Gen", handle: "airpods-pro-3", price: 249, category: "headphones" },
  { title: "Apple Watch Ultra 3", handle: "apple-watch-ultra-3", price: 799, category: "watches" },
  { title: "iPad Pro 12.9-inch M4", handle: "ipad-pro-12", price: 1099, category: "laptops" },
  { title: "AirPods Max", handle: "airpods-max", price: 549, category: "headphones" },
]

const HOT_DEALS_PRODUCTS = [
  { title: "Samsung Galaxy S24 Ultra", handle: "samsung-s24-ultra", price: 899, originalPrice: 1199, category: "phones" },
  { title: "Sony WH-1000XM5 Headphones", handle: "sony-wh1000xm5", price: 279, originalPrice: 399, category: "headphones" },
  { title: "JBL Flip 6 Speaker", handle: "jbl-flip-6", price: 99, originalPrice: 149, category: "accessories" },
  { title: "Logitech G Pro X Gaming Headset", handle: "logitech-gpro-x", price: 149, originalPrice: 199, category: "gaming" },
  { title: "Anker PowerCore 26800mAh", handle: "anker-powercore-26800", price: 49, originalPrice: 79, category: "powerbanks" },
  { title: "Samsung Galaxy Watch 6", handle: "samsung-watch-6", price: 249, originalPrice: 349, category: "watches" },
]

const POWERBANK_PRODUCTS = [
  { title: "Anker PowerCore 20000mAh", handle: "anker-powercore-20000", price: 39, category: "powerbanks" },
  { title: "Xiaomi Power Bank 3 Pro", handle: "xiaomi-pb3-pro", price: 49, category: "powerbanks" },
  { title: "Samsung 25W Wireless Power Bank", handle: "samsung-wireless-pb", price: 59, category: "powerbanks" },
  { title: "Baseus 65W Power Bank 30000mAh", handle: "baseus-65w-30000", price: 79, category: "powerbanks" },
  { title: "Anker 737 PowerCore 24K", handle: "anker-737-24k", price: 99, category: "powerbanks" },
  { title: "UGREEN 145W Power Bank", handle: "ugreen-145w", price: 89, category: "powerbanks" },
]

// Video content for media gallery
const VIDEO_DATA = [
  {
    title: "iPhone 17 Pro Unboxing",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    thumbnail_url: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=300&h=400&fit=crop",
    type: "video",
  },
  {
    title: "Best Gaming Setup 2026",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    thumbnail_url: "https://images.unsplash.com/photo-1593118247619-e2d6f056869e?w=300&h=400&fit=crop",
    type: "video",
  },
  {
    title: "Headphones Comparison",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    thumbnail_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&h=400&fit=crop",
    type: "video",
  },
  {
    title: "Smart Watch Review",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    thumbnail_url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&h=400&fit=crop",
    type: "video",
  },
]

export default async function seedHomepageContent({ container }: ExecArgs) {
  const productService: IProductModuleService = container.resolve(Modules.PRODUCT)
  
  let brandService: any = null
  let mediaService: any = null

  try {
    brandService = container.resolve(BRAND_MODULE)
  } catch (e) {
    console.log("Brand module not available")
  }

  try {
    mediaService = container.resolve(MEDIA_MODULE)
  } catch (e) {
    console.log("Media module not available")
  }

  console.log("🚀 Starting Homepage Content Seeding...")
  console.log("=" .repeat(50))

  // 1. Create/Update Brands
  if (brandService) {
    console.log("\n📦 Creating Brands...")
    for (const brand of BRAND_DATA) {
      try {
        const existing = await brandService.listBrands({ slug: brand.slug })
        if (existing && existing.length > 0) {
          // Update existing brand with logo
          await brandService.updateBrands(existing[0].id, {
            logo_url: brand.logo_url,
            is_active: true,
          })
          console.log(`  ✓ Updated brand: ${brand.name}`)
        } else {
          // Create new brand
          await brandService.createBrands([{
            name: brand.name,
            slug: brand.slug,
            logo_url: brand.logo_url,
            is_active: true,
          }])
          console.log(`  ✓ Created brand: ${brand.name}`)
        }
      } catch (e: any) {
        console.log(`  ⚠ Brand ${brand.name}: ${e.message}`)
      }
    }
  }

  // 2. Create Collections if they don't exist
  console.log("\n📁 Ensuring Collections exist...")
  const collections = [
    { title: "Apple", handle: "apple" },
    { title: "Hot Deals", handle: "hot-deals" },
    { title: "Best in Power Banks", handle: "best-in-power-banks" },
    { title: "New Arrivals", handle: "new-arrival" },
  ]

  const collectionMap: Record<string, string> = {}

  for (const coll of collections) {
    try {
      const existing = await productService.listProductCollections({ handle: coll.handle })
      if (existing.length > 0) {
        collectionMap[coll.handle] = existing[0].id
        console.log(`  ✓ Collection exists: ${coll.title}`)
      } else {
        const created = await productService.createProductCollections({
          title: coll.title,
          handle: coll.handle,
        })
        collectionMap[coll.handle] = created.id
        console.log(`  ✓ Created collection: ${coll.title}`)
      }
    } catch (e: any) {
      console.log(`  ⚠ Collection ${coll.title}: ${e.message}`)
    }
  }

  // 3. Demo Products (Skipped unless SEED_DEMO_PRODUCTS=true is passed)
  const shouldSeedProducts = process.env.SEED_DEMO_PRODUCTS === "true"
  if (shouldSeedProducts) {
    console.log("\n🍎 Creating Apple Products...")
    for (const product of APPLE_PRODUCTS) {
    try {
      const existing = await productService.listProducts({ handle: product.handle })
      if (existing.length > 0) {
        // Update thumbnail
        const images = PRODUCT_IMAGES[product.category as keyof typeof PRODUCT_IMAGES] || PRODUCT_IMAGES.accessories
        await productService.updateProducts(existing[0].id, {
          thumbnail: images[Math.floor(Math.random() * images.length)],
        })
        // Add to collection
        if (collectionMap["apple"]) {
          try {
            await productService.updateProductCollections(collectionMap["apple"], {
              product_ids: [existing[0].id],
            })
          } catch (e) {
            // Already in collection
          }
        }
        console.log(`  ✓ Updated: ${product.title}`)
      } else {
        const images = PRODUCT_IMAGES[product.category as keyof typeof PRODUCT_IMAGES] || PRODUCT_IMAGES.accessories
        const created = await productService.createProducts({
          title: product.title,
          handle: product.handle,
          thumbnail: images[Math.floor(Math.random() * images.length)],
          status: "published",
          collection_id: collectionMap["apple"],
        })
        console.log(`  ✓ Created: ${product.title}`)
      }
    } catch (e: any) {
      console.log(`  ⚠ Product ${product.title}: ${e.message}`)
    }
  }

  // 4. Create Hot Deals Products
  console.log("\n🔥 Creating Hot Deals Products...")
  for (const product of HOT_DEALS_PRODUCTS) {
    try {
      const existing = await productService.listProducts({ handle: product.handle })
      if (existing.length > 0) {
        const images = PRODUCT_IMAGES[product.category as keyof typeof PRODUCT_IMAGES] || PRODUCT_IMAGES.accessories
        await productService.updateProducts(existing[0].id, {
          thumbnail: images[Math.floor(Math.random() * images.length)],
        })
        console.log(`  ✓ Updated: ${product.title}`)
      } else {
        const images = PRODUCT_IMAGES[product.category as keyof typeof PRODUCT_IMAGES] || PRODUCT_IMAGES.accessories
        await productService.createProducts({
          title: product.title,
          handle: product.handle,
          thumbnail: images[Math.floor(Math.random() * images.length)],
          status: "published",
          collection_id: collectionMap["hot-deals"],
        })
        console.log(`  ✓ Created: ${product.title}`)
      }
    } catch (e: any) {
      console.log(`  ⚠ Product ${product.title}: ${e.message}`)
    }
  }

  // 5. Create Power Bank Products
  console.log("\n🔋 Creating Power Bank Products...")
  for (const product of POWERBANK_PRODUCTS) {
    try {
      const existing = await productService.listProducts({ handle: product.handle })
      if (existing.length > 0) {
        await productService.updateProducts(existing[0].id, {
          thumbnail: PRODUCT_IMAGES.powerbanks[Math.floor(Math.random() * PRODUCT_IMAGES.powerbanks.length)],
        })
        console.log(`  ✓ Updated: ${product.title}`)
      } else {
        await productService.createProducts({
          title: product.title,
          handle: product.handle,
          thumbnail: PRODUCT_IMAGES.powerbanks[Math.floor(Math.random() * PRODUCT_IMAGES.powerbanks.length)],
          status: "published",
          collection_id: collectionMap["best-in-power-banks"],
        })
        console.log(`  ✓ Created: ${product.title}`)
      }
    } catch (e: any) {
      console.log(`  ⚠ Product ${product.title}: ${e.message}`)
    }
  }
  } else {
    console.log("\nℹ️ Skipping demo product creation (SEED_DEMO_PRODUCTS is set to false/not passed)")
  }

  // 6. Create Media/Videos
  if (mediaService) {
    console.log("\n🎬 Creating Media/Videos...")
    for (const video of VIDEO_DATA) {
      try {
        const existing = await mediaService.listMedia({ title: video.title })
        if (!existing || existing.length === 0) {
          await mediaService.createMedia([{
            title: video.title,
            url: video.url,
            thumbnail_url: video.thumbnail_url,
            type: "video",
            is_active: true,
          }])
          console.log(`  ✓ Created video: ${video.title}`)
        } else {
          console.log(`  ✓ Video exists: ${video.title}`)
        }
      } catch (e: any) {
        console.log(`  ⚠ Video ${video.title}: ${e.message}`)
      }
    }
  }

  // 7. Create Hero Banners
  console.log("\n🖼️ Creating Hero Banners...")
  try {
    // Check if there's a homepage/banners module
    const homepageModule = container.resolve("homepage") as any
    if (homepageModule) {
      for (const banner of BANNER_DATA) {
        try {
          await homepageModule.createBanner({
            title: banner.title,
            subtitle: banner.subtitle,
            image_url: banner.image_url,
            link: banner.link,
            is_active: true,
            position: "hero",
          })
          console.log(`  ✓ Created banner: ${banner.title}`)
        } catch (e: any) {
          console.log(`  ⚠ Banner ${banner.title}: ${e.message}`)
        }
      }
    }
  } catch (e) {
    console.log("  ℹ Homepage module not available, banners will use static data")
  }

  console.log("\n" + "=".repeat(50))
  console.log("✅ Homepage Content Seeding Complete!")
  console.log("\n📋 Summary:")
  console.log(`  • Brands: ${BRAND_DATA.length} processed`)
  console.log(`  • Apple Products: ${APPLE_PRODUCTS.length} processed`)
  console.log(`  • Hot Deals: ${HOT_DEALS_PRODUCTS.length} processed`)
  console.log(`  • Power Banks: ${POWERBANK_PRODUCTS.length} processed`)
  console.log(`  • Videos: ${VIDEO_DATA.length} processed`)
  console.log(`  • Banners: ${BANNER_DATA.length} processed`)
  console.log("\n🌐 Refresh your frontend at localhost:3000 to see the changes!")
}
