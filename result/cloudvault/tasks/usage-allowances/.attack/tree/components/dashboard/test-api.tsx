"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import type { ApiKeyData } from "@/lib/firestore";
import { Upload, Download, Copy, Check } from "lucide-react";

interface TestApiProps {
  apiKeys: ApiKeyData[];
  isLoading: boolean;
  onLoadUserData: () => Promise<void>;
}

export function TestApi({ apiKeys, isLoading, onLoadUserData }: TestApiProps) {
  const [testFile, setTestFile] = useState<File | null>(null);
  const [testFileId, setTestFileId] = useState("");
  const [testResults, setTestResults] = useState<any>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false); // Add state for upload loading
  const [isDownloading, setIsDownloading] = useState(false); // Add state for download loading

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const testUpload = async () => {
    if (!testFile || apiKeys.length === 0) return;

    setTestResults(null);
    setIsUploading(true); // Set uploading state to true

    try {
      const formData = new FormData();
      formData.append("file", testFile);

      const response = await fetch("/api/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKeys[0].apiKey}`,
        },
        body: formData,
      });

      const result = await response.json();
      setTestResults(result);

      if (result.success) {
        await onLoadUserData(); // Refresh stats
      }
    } catch (error) {
      console.error("Upload test error:", error);
      setTestResults({ success: false, message: "Upload failed" });
    } finally {
      setIsUploading(false); // Reset uploading state
    }
  };

  const testDownload = async () => {
    if (!testFileId.trim() || apiKeys.length === 0) return;

    setTestResults(null);
    setIsDownloading(true); // Set downloading state to true

    try {
      const response = await fetch(`/api/file/${testFileId.trim()}`, {
        headers: {
          Authorization: `Bearer ${apiKeys[0].apiKey}`,
        },
      });

      const result = await response.json();
      setTestResults(result);

      if (result.success) {
        await onLoadUserData(); // Refresh stats
      }
    } catch (error) {
      console.error("Download test error:", error);
      setTestResults({ success: false, message: "Download failed" });
    } finally {
      setIsDownloading(false); // Reset downloading state
    }
  };

  const codeExamples = {
    python: `import requests

# Upload a file
with open('document.pdf', 'rb') as file:
    response = requests.post(
        '${
          typeof window !== "undefined" ? window.location.origin : ""
        }/api/upload',
        headers={'Authorization': 'Bearer ${
          apiKeys[0]?.apiKey || "YOUR_API_KEY"
        }'},
        files={'file': file}
    )
    result = response.json()
    print(f"File ID: {result['data']['fileId']}")

# Download a file
response = requests.get(
    '${
      typeof window !== "undefined" ? window.location.origin : ""
    }/api/file/FILE_ID',
    headers={'Authorization': 'Bearer ${apiKeys[0]?.apiKey || "YOUR_API_KEY"}'}
)
file_data = response.json()
print(f"Download URL: {file_data['data']['fileLink']}")`,

    nodejs: `const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');

// Upload a file
const uploadFile = async () => {
    const form = new FormData();
    form.append('file', fs.createReadStream('document.pdf'));
    
    const response = await fetch('${
      typeof window !== "undefined" ? window.location.origin : ""
    }/api/upload', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ${apiKeys[0]?.apiKey || "YOUR_API_KEY"}'
        },
        body: form
    });
    
    const result = await response.json();
    console.log('File ID:', result.data.fileId);
};

// Download a file
const downloadFile = async (fileId) => {
    const response = await fetch(\`${
      typeof window !== "undefined" ? window.location.origin : ""
    }/api/file/\${fileId}\`, {
        headers: {
            'Authorization': 'Bearer ${apiKeys[0]?.apiKey || "YOUR_API_KEY"}'
        }
    });
    
    const fileData = await response.json();
    console.log('Download URL:', fileData.data.fileLink);
};`,

    curl: `# Upload a file
curl -X POST "${
      typeof window !== "undefined" ? window.location.origin : ""
    }/api/upload" \\
  -H "Authorization: Bearer ${apiKeys[0]?.apiKey || "YOUR_API_KEY"}" \\
  -F "file=@document.pdf"

# Download a file
curl -X GET "${
      typeof window !== "undefined" ? window.location.origin : ""
    }/api/file/FILE_ID" \\
  -H "Authorization: Bearer ${apiKeys[0]?.apiKey || "YOUR_API_KEY"}"`,

    javascript: `// Upload a file
const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch('${
      typeof window !== "undefined" ? window.location.origin : ""
    }/api/upload', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ${apiKeys[0]?.apiKey || "YOUR_API_KEY"}'
        },
        body: formData
    });
    
    const result = await response.json();
    console.log('File ID:', result.data.fileId);
    return result;
};

// Download a file
const downloadFile = async (fileId) => {
    const response = await fetch(\`${
      typeof window !== "undefined" ? window.location.origin : ""
    }/api/file/\${fileId}\`, {
        headers: {
            'Authorization': 'Bearer ${apiKeys[0]?.apiKey || "YOUR_API_KEY"}'
        }
    });
    
    const fileData = await response.json();
    console.log('Download URL:', fileData.data.fileLink);
    return fileData;
};`,
  };

  return (
    <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
      <CardHeader>
        <CardTitle>Test API & Code Examples</CardTitle>
        <CardDescription>
          Test your API endpoints and view code examples
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {apiKeys.length > 0 ? (
          <>
            <Tabs defaultValue="test" className="w-full">
              <TabsList className="grid w-full grid-cols-2 gap-6">
                <TabsTrigger
                  value="test"
                  className="border border-slate-300 cursor-pointer"
                >
                  Test API
                </TabsTrigger>
                <TabsTrigger
                  value="examples"
                  className="border border-slate-300 cursor-pointer"
                >
                  Code Examples
                </TabsTrigger>
              </TabsList>

              <TabsContent value="test" className="space-y-4">
                {/* Upload Test */}
                <div className="space-y-2">
                  <Label>Test Upload</Label>
                  <div className="flex space-x-2">
                    <Input
                      type="file"
                      onChange={(e) => setTestFile(e.target.files?.[0] || null)}
                    />
                    <Button
                      onClick={testUpload}
                      disabled={isLoading || !testFile || isUploading}
                      className="border border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-95 transition-transform duration-200 hover:border-slate-400"
                    >
                      {isUploading ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Uploading
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Upload
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Download Test */}
                <div className="space-y-2">
                  <Label>Test Download</Label>
                  <div className="flex space-x-2">
                    <Input
                      placeholder="Enter file ID"
                      value={testFileId}
                      onChange={(e) => setTestFileId(e.target.value)}
                    />
                    <Button
                      onClick={testDownload}
                      disabled={
                        isLoading || !testFileId.trim() || isDownloading
                      }
                      className="border border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-95 transition-transform duration-200 hover:border-slate-400"
                    >
                      {isDownloading ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Downloading
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Test Results */}
                {testResults && (
                  <div className="mt-4">
                    <Label>Response</Label>
                    <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg mt-2">
                      <pre className="text-sm overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(testResults, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="examples" className="space-y-4">
                <Tabs defaultValue="python" className="w-full">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="python">Python</TabsTrigger>
                    <TabsTrigger value="nodejs">Node.js</TabsTrigger>
                    <TabsTrigger value="javascript">JavaScript</TabsTrigger>
                    <TabsTrigger value="curl">cURL</TabsTrigger>
                  </TabsList>

                  {Object.entries(codeExamples).map(([lang, code]) => (
                    <TabsContent key={lang} value={lang}>
                      <div className="relative">
                        <Button
                          variant="outline"
                          size="sm"
                          className="absolute top-2 right-2 z-10 bg-transparent"
                          onClick={() => copyToClipboard(code, lang)}
                        >
                          {copied === lang ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                        <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                          <code>{code}</code>
                        </pre>
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>Create an API key first to test the endpoints</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
