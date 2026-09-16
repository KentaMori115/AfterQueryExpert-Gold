import sharp from "sharp"

export interface ImageTransformOptions {
    width?: number
    height?: number
    fit?: "cover" | "contain" | "fill" | "inside" | "outside"
    format?: "jpeg" | "png" | "webp" | "avif"
    quality?: number
    blur?: number
    grayscale?: boolean
}

/**
 * Transforms an input image Buffer using Sharp according to parameters.
 */
export async function transformImageBuffer(
    inputBuffer: Buffer,
    options: ImageTransformOptions = {}
): Promise<{ buffer: Buffer; contentType: string }> {
    let pipeline = sharp(inputBuffer)

    // Resize
    if (options.width || options.height) {
        pipeline = pipeline.resize({
            width: options.width ? Number(options.width) : undefined,
            height: options.height ? Number(options.height) : undefined,
            fit: options.fit || "cover",
            withoutEnlargement: true,
        })
    }

    // Grayscale
    if (options.grayscale) {
        pipeline = pipeline.grayscale()
    }

    // Blur
    if (options.blur && options.blur > 0) {
        const blurSigma = Math.min(50, Math.max(0.3, Number(options.blur)))
        pipeline = pipeline.blur(blurSigma)
    }

    // Format & Quality
    const fmt = options.format?.toLowerCase() || "webp"
    const quality = options.quality ? Math.min(100, Math.max(1, Number(options.quality))) : 80

    let contentType = "image/webp"

    switch (fmt) {
        case "jpeg":
        case "jpg":
            pipeline = pipeline.jpeg({ quality })
            contentType = "image/jpeg"
            break
        case "png":
            pipeline = pipeline.png({ compressionLevel: 8 })
            contentType = "image/png"
            break
        case "avif":
            pipeline = pipeline.avif({ quality })
            contentType = "image/avif"
            break
        case "webp":
        default:
            pipeline = pipeline.webp({ quality })
            contentType = "image/webp"
            break
    }

    const buffer = await pipeline.toBuffer()
    return { buffer, contentType }
}
