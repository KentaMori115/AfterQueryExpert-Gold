import { transformImageBuffer } from "../lib/image-processor"
import sharp from "sharp"

describe("Image Processor (Sharp)", () => {
    it("transforms raw pixel buffer into webp image", async () => {
        // Generate 100x100 solid red PNG buffer
        const rawPng = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 4,
                background: { r: 255, g: 0, b: 0, alpha: 1 },
            },
        })
            .png()
            .toBuffer()

        const result = await transformImageBuffer(rawPng, {
            width: 50,
            height: 50,
            format: "webp",
            quality: 75,
            grayscale: true,
        })

        expect(result.buffer).toBeDefined()
        expect(result.contentType).toBe("image/webp")
        expect(result.buffer.length).toBeGreaterThan(0)
    })
})
