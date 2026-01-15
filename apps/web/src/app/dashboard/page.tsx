'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { PaperList } from '@/components/dashboard/PaperList';
import { UploadModal } from '@/components/dashboard/UploadModal';
import { Button } from '@/components/ui/Button';
import { papersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Upload, LogOut, BookOpen } from 'lucide-react';

export default function DashboardPage() {
    const queryClient = useQueryClient();
    const { user, logout } = useAuthStore();
    const [showUpload, setShowUpload] = useState(false);

    const { data: papers = [], isLoading } = useQuery({
        queryKey: ['papers'],
        queryFn: papersApi.list,
    });

    const uploadMutation = useMutation({
        mutationFn: papersApi.upload,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['papers'] });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: papersApi.delete,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['papers'] });
        },
    });

    return (
        <AuthGuard>
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
                <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <BookOpen className="w-8 h-8 text-blue-600" />
                            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                                PaperTree
                            </h1>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                                {user?.email}
                            </span>
                            <Button variant="ghost" size="sm" onClick={logout}>
                                <LogOut className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                </header>

                <main className="max-w-7xl mx-auto px-4 py-8">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                            My Papers
                        </h2>
                        <Button onClick={() => setShowUpload(true)}>
                            <Upload className="w-4 h-4 mr-2" />
                            Upload Paper
                        </Button>
                    </div>

                    {isLoading ? (
                        <div className="flex items-center justify-center h-64">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                        </div>
                    ) : (
                        <PaperList
                            papers={papers}
                            onDelete={(id) => deleteMutation.mutate(id)}
                            isDeleting={deleteMutation.isPending}
                        />
                    )}
                </main>

                <UploadModal
                    isOpen={showUpload}
                    onClose={() => setShowUpload(false)}
                    onUpload={async (file) => {
                        await uploadMutation.mutateAsync(file);
                    }}
                    isUploading={uploadMutation.isPending}
                />
            </div>
        </AuthGuard>
    );
}