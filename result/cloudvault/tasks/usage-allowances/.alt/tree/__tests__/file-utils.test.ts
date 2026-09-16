import {
    MAX_FILE_SIZE,
    MIME_TYPES,
    getExtension,
    formatSizeMB,
    formatBytes,
    stripExtension,
    getContentType,
    buildDownloadFilename,
    getFileNameFromPath,
} from "../lib/file-utils"

describe("getExtension", () => {
    it("returns the lowercase extension without a dot", () => {
        expect(getExtension("report.pdf")).toBe("pdf")
    })

    it("handles uppercase extensions by lowercasing them", () => {
        expect(getExtension("PHOTO.JPG")).toBe("jpg")
    })

    it("returns empty string when there is no dot", () => {
        expect(getExtension("noextension")).toBe("")
    })

    it("handles dotted filenames like archive.tar.gz", () => {
        expect(getExtension("archive.tar.gz")).toBe("gz")
    })

    it("handles filenames with dots in the base name", () => {
        expect(getExtension("my.file.name.txt")).toBe("txt")
    })

    it("returns empty string for a trailing dot", () => {
        expect(getExtension("file.")).toBe("")
    })

    it("handles hidden files like .gitignore", () => {
        expect(getExtension(".gitignore")).toBe("gitignore")
    })

    it("handles empty strings", () => {
        expect(getExtension("")).toBe("")
    })

    it("handles whitespace-only names", () => {
        expect(getExtension("   ")).toBe("")
    })

    it("handles names with trailing spaces before the extension", () => {
        expect(getExtension("image.png ")).toBe("png ")
    })
})

describe("formatSizeMB", () => {
    it("formats zero bytes", () => {
        expect(formatSizeMB(0)).toBe("0.00 MB")
    })

    it("formats a 1 MB file", () => {
        expect(formatSizeMB(1024 * 1024)).toBe("1.00 MB")
    })

    it("formats a 50 MB file", () => {
        expect(formatSizeMB(50 * 1024 * 1024)).toBe("50.00 MB")
    })

    it("formats sub-megabyte sizes", () => {
        expect(formatSizeMB(512 * 1024)).toBe("0.50 MB")
    })

    it("rounds to two decimals", () => {
        expect(formatSizeMB(1024 * 1024 * 1.333)).toBe("1.33 MB")
    })

    it("handles large multi-gigabyte sizes", () => {
        expect(formatSizeMB(3 * 1024 * 1024 * 1024)).toBe("3072.00 MB")
    })
})

describe("formatBytes", () => {
    it("returns 0 Bytes for zero", () => {
        expect(formatBytes(0)).toBe("0 Bytes")
    })

    it("formats bytes", () => {
        expect(formatBytes(500)).toBe("500 Bytes")
    })

    it("formats kilobytes", () => {
        expect(formatBytes(1024)).toBe("1 KB")
    })

    it("formats megabytes", () => {
        expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB")
    })

    it("formats gigabytes", () => {
        expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2 GB")
    })

    it("rounds decimal values", () => {
        expect(formatBytes(1536)).toBe("1.5 KB")
    })

    it("formats exact boundary values", () => {
        expect(formatBytes(1024 * 1024)).toBe("1 MB")
    })
})

describe("stripExtension", () => {
    it("removes a simple extension", () => {
        expect(stripExtension("photo.jpg")).toBe("photo")
    })

    it("keeps dotted base names intact", () => {
        expect(stripExtension("my.file.name.txt")).toBe("my.file.name")
    })

    it("removes only the final extension", () => {
        expect(stripExtension("archive.tar.gz")).toBe("archive.tar")
    })

    it("leaves names without an extension unchanged", () => {
        expect(stripExtension("README")).toBe("README")
    })

    it("handles paths with directories", () => {
        expect(stripExtension("documents/file_7")).toBe("documents/file_7")
    })

    it("handles directory paths with extensions", () => {
        expect(stripExtension("documents/report.pdf")).toBe("documents/report")
    })
})

describe("getContentType", () => {
    it("maps jpg to image/jpeg", () => {
        expect(getContentType("jpg")).toBe("image/jpeg")
    })

    it("maps jpeg to image/jpeg", () => {
        expect(getContentType("jpeg")).toBe("image/jpeg")
    })

    it("maps png to image/png", () => {
        expect(getContentType("png")).toBe("image/png")
    })

    it("maps gif to image/gif", () => {
        expect(getContentType("gif")).toBe("image/gif")
    })

    it("maps webp to image/webp", () => {
        expect(getContentType("webp")).toBe("image/webp")
    })

    it("maps mp4 to video/mp4", () => {
        expect(getContentType("mp4")).toBe("video/mp4")
    })

    it("maps mov to video/quicktime", () => {
        expect(getContentType("mov")).toBe("video/quicktime")
    })

    it("maps pdf to application/pdf", () => {
        expect(getContentType("pdf")).toBe("application/pdf")
    })

    it("maps txt to text/plain", () => {
        expect(getContentType("txt")).toBe("text/plain")
    })

    it("normalizes uppercase extensions", () => {
        expect(getContentType("PNG")).toBe("image/png")
    })

    it("falls back to octet-stream for unknown extensions", () => {
        expect(getContentType("xyz")).toBe("application/octet-stream")
    })

    it("falls back for empty strings", () => {
        expect(getContentType("")).toBe("application/octet-stream")
    })

    it("every MIME_TYPES entry is a non-empty string", () => {
        for (const [ext, type] of Object.entries(MIME_TYPES)) {
            expect(ext.length).toBeGreaterThan(0)
            expect(type.length).toBeGreaterThan(0)
        }
    })
})

describe("buildDownloadFilename", () => {
    it("returns original filename when extension is missing", () => {
        expect(buildDownloadFilename("report", "")).toBe("report")
    })

    it("keeps filename already ending in the extension", () => {
        expect(buildDownloadFilename("photo.jpg", "jpg")).toBe("photo.jpg")
    })

    it("appends the extension when missing", () => {
        expect(buildDownloadFilename("photo", "jpg")).toBe("photo.jpg")
    })

    it("replaces a wrong extension", () => {
        expect(buildDownloadFilename("photo.png", "jpg")).toBe("photo.jpg")
    })

    it("handles dotted base names", () => {
        expect(buildDownloadFilename("archive.tar.gz", "txt")).toBe("archive.tar.txt")
    })

    it("handles uppercase original extensions", () => {
        expect(buildDownloadFilename("PHOTO.PNG", "png")).toBe("PHOTO.png")
    })
})

describe("getFileNameFromPath", () => {
    it("extracts the last path segment", () => {
        expect(getFileNameFromPath("documents/file_7", "fallback")).toBe("file_7")
    })

    it("returns the fallback for empty paths", () => {
        expect(getFileNameFromPath("", "fallback")).toBe("fallback")
    })

    it("returns the segment for paths with nested directories", () => {
        expect(getFileNameFromPath("a/b/c/report.pdf", "fallback")).toBe("report.pdf")
    })

    it("handles trailing slashes", () => {
        expect(getFileNameFromPath("documents/", "fallback")).toBe("fallback")
    })

    it("handles a single segment path", () => {
        expect(getFileNameFromPath("file_7", "fallback")).toBe("file_7")
    })
})

describe("MAX_FILE_SIZE", () => {
    it("is exactly 250MB", () => {
        expect(MAX_FILE_SIZE).toBe(250 * 1024 * 1024)
    })
})
