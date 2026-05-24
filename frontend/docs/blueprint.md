# **App Name**: PassBar

## Core Features:

- Custom Test Builder: Configure tests based on subject areas, question status (e.g., 'Unused', 'Incorrect'), and test mode (Tutor or Timed) as depicted in the provided UI.
- Dynamic Question Loading: Load exam questions and associated data from a JSON structure, supporting different explanation methods.
- Question Page UI: A dedicated question page interface for users to answer and review questions.
- Interactive Question Interface: Display questions with answer choices, allow users to select an answer for submission, and provide tools for in-test interaction such as bookmarking, highlighting, and adding notes.
- Generative Explanation Tool: If 'apiMatchOk' is true for a question, this tool generates a textual explanation by analyzing relevant images ('explain_imgs'). Otherwise, it displays a predefined image explanation ('sourceExplanationImageFile').
- Performance Tracking Dashboard: Provide a basic dashboard to track user performance across different subjects and test attempts, including overall progress and specific areas of strength/weakness.
- Study Progress Review: Allow users to revisit answered questions, review explanations, and understand their correct/incorrect responses.

## Style Guidelines:

- Primary brand color: A deep, professional blue (#0C61A8) to convey trustworthiness and clarity, contrasting well with a light background for readability.
- Background color: A very light, subtle blue-gray (#EBF3F8) providing a clean, open canvas for content.
- Accent color: A vibrant, clear aqua (#33B6C9) for interactive elements and highlights, adding a fresh and engaging touch.
- Body and headline font: 'Inter' (sans-serif) for its modern, highly readable, and versatile design suitable for extensive textual content like exam questions and explanations.
- Use minimalist and functional icons to guide navigation and indicate actions clearly, maintaining a clean and professional aesthetic akin to the provided UWorld screenshot.
- Employ a structured, multi-column layout for the application, including a fixed sidebar for primary navigation. For the question-answering pages, utilize a distinct layout with a fixed top header for test controls (e.g., timer, question number, utilities), a fixed bottom footer for session navigation (e.g., End, Suspend, Previous, Next, Feedback), and a central content area for question text, answer options, and interactive elements.
- Implement subtle, fast-response animations for form submissions, content transitions, and feedback on user interactions to enhance responsiveness without being distracting.
