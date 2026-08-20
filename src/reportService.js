import { fetchFromBackend } from './api'; 

// Use "export const" to make it a named export
export const submitAdminReport = async (reportData, file) => {
  // 1. Get Presigned URL
  const uploadData = await fetchFromBackend('/get-upload-url', {
    method: 'POST',
    body: JSON.stringify({
      fileType: file.type,
      fileName: file.name
    }),
  });

  // 2. Upload file directly to B2
  const uploadResponse = await fetch(uploadData.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });

  if (!uploadResponse.ok) throw new Error("Failed to upload file to storage.");

  // 3. Create the report in Firestore via your backend
  return await fetchFromBackend('/reports', {
    method: 'POST',
    body: JSON.stringify({
      ...reportData,
      mediaUrl: fileUrl, // Ensure fileUrl is returned from your backend
    }),
  });
};