'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function ConfirmPage() {
  const router = useRouter()
  const [countdown, setCountdown] = useState(3)

  useEffect(() => {
    // Countdown timer
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          router.push('/dashboard')
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-emerald-50 to-teal-100 px-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-4 pb-8">
          {/* Success Icon with Animation */}
          <div className="mx-auto w-20 h-20 bg-green-100 rounded-full flex items-center justify-center animate-pulse">
            <svg
              className="w-10 h-10 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>

          <div>
            <CardTitle className="text-3xl font-bold text-gray-900">
              Email Confirmed! 🎉
            </CardTitle>
            <CardDescription className="text-base mt-2">
              Your email has been successfully verified
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Success Message */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-sm text-green-800 text-center">
              <span className="font-semibold block mb-2">Welcome aboard!</span>
              Your account is now active and ready to use.
            </p>
          </div>

          {/* Redirect Info */}
          <div className="text-center space-y-4">
            <p className="text-sm text-gray-600">
              Redirecting to your dashboard in{' '}
              <span className="font-bold text-2xl text-blue-600">{countdown}</span>{' '}
              {countdown === 1 ? 'second' : 'seconds'}...
            </p>

            {/* Loading bar animation */}
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-1000 ease-linear"
                style={{ width: `${((3 - countdown) / 3) * 100}%` }}
              />
            </div>

            {/* Manual redirect button */}
            <Button
              onClick={() => router.push('/dashboard')}
              className="w-full"
              size="lg"
            >
              Go to Dashboard Now
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

