# Floorplan Analyzer

A Next.js web application that uses AI to analyze architectural floorplans, detect scales, and calculate areas. Perfect for antenna placement planning and space analysis.

![Floorplan Analyzer](https://img.shields.io/badge/Next.js-14.2.5-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-blue)

## Features

- **Drag & Drop Upload**: Support for PDF and image files (PNG, JPG, etc.)
- **Multi-floor PDF Ingestion**: Automatically splits multi-page PDFs into per-floor entries with coverage heuristics
- **AI Scale Detection**: Automatically detect scale bars and dimension annotations
- **Manual Scale Setting**: Draw reference lines and set known distances
- **Area Calculation**: Select areas with polygon drawing tools
- **Real-time Canvas**: Interactive drawing on uploaded floorplans
- **Multiple Area Support**: Calculate multiple areas in a single floorplan

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, TailwindCSS
- **Canvas Drawing**: HTML5 Canvas with custom drawing tools
- **File Processing**: react-dropzone, pdf-lib
- **State Management**: React hooks
- **Deployment**: Vercel-ready
- **Storage**: Firebase integration ready

## Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

### Installation

1. Clone the repository:
```bash
git clone https://github.com/dj-iv/plan.git
cd plan
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Usage

### Basic Workflow

1. **Upload Floorplans**
   - Drag and drop a PDF or image file into the upload area
   - Supported formats: PDF, PNG, JPG, GIF, BMP (up to 50MB)
   - Multi-page PDFs are rendered page-by-page; likely text-only pages are skipped automatically

2. **Set the Scale**
   - **Auto Detection**: Click "Auto Detect Scale" to let AI find scale bars
   - **Manual Scale**: 
     - Click "Manual Scale"
     - Draw a line on a known distance in the floorplan
     - Enter the real-world measurement and units

3. **Work with Multiple Floors (Optional)**
   - Each PDF page becomes its own staged floor; rename or delete any before analysis
   - Re-open the "Add Floor" button inside a project to append more pages later

4. **Select Areas**
   - Click "Select Area" mode
   - Click points around the area you want to measure
   - Click "Finish Area" when done (minimum 3 points)

5. **View Results**
   - Calculated areas appear in the results panel
   - Areas are displayed in your selected units (meters², feet², etc.)

### Working with Multi-page PDFs

- The renderer scans up to 40 pages per upload to keep the experience snappy.
- Pages with very low ink coverage (typically schedules or cover sheets) are flagged as text-heavy and skipped by default. They can be restored from the staged list if needed.
- Coverage heuristics and fallback renderers surface warnings in the UI so you know when manual review is recommended.
- If the primary PDF renderer fails, the app automatically tries alternate converters and labels the affected pages.

### Controls

- **Select Area**: Click mode for drawing area boundaries
- **Finish Area**: Complete the current area selection
- **Clear All**: Remove all drawn areas
- **Scale Settings**: Set measurement scale manually or auto-detect

## Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout component
│   └── page.tsx           # Home page component
├── components/            # React components
│   ├── FileUpload.tsx     # Drag & drop file upload
│   ├── FloorplanCanvas.tsx # Interactive canvas for drawing
│   └── ScaleControl.tsx   # Scale detection and manual setting
```

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

### Key Components

#### FileUpload Component
Handles drag & drop file uploads with validation and preview.

#### FloorplanCanvas Component  
Interactive canvas that allows:
- Image display and scaling
- Polygon drawing for area selection
- Real-time area calculations
- Visual feedback for drawn areas

#### ScaleControl Component
Manages scale detection and manual scale setting with support for different units.

## Future Enhancements

### Phase 2: AI-Powered Features
- Computer vision for automatic scale detection
- Wall and room boundary recognition
- Advanced OCR for dimension reading

### Phase 3: Antenna Planning
- RF coverage calculation
- Antenna placement optimization
- Signal strength modeling
- Export antenna placement reports

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Deployment

### Vercel Deployment

This project is optimized for Vercel deployment:

1. Connect your GitHub repository to Vercel
2. Configure environment variables (if using Firebase)
3. Deploy automatically on push to main branch

### Environment Variables

Create a `.env.local` file for local development:

```bash
# Firebase configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# Restrict app sign-in to specific Google Workspace domains (comma-separated)
NEXT_PUBLIC_ALLOWED_GOOGLE_DOMAINS=uctel.co.uk

# UCtel portal integration
PORTAL_SIGNING_SECRET=matching_secret_from_portal
NEXT_PUBLIC_PORTAL_URL=https://portal.yourdomain.co.uk
# Optional: bypass portal redirect during local development only
# PORTAL_DEV_BYPASS=1
```

When working locally without the portal, set `PORTAL_DEV_BYPASS=1` (and optionally `PORTAL_DEV_BYPASS_COOKIE` for a custom placeholder cookie) to skip the redirect enforced by the middleware. The flag is ignored in production builds.

### Firebase Security Rules

This repo includes `firestore.rules` and `storage.rules` to restrict access to authenticated users. Deploy them with the Firebase CLI:

```powershell
# Install Firebase CLI if needed
npm i -g firebase-tools

# Login and set the active project
firebase login
firebase use <your-project-id>

# Deploy security rules
firebase deploy --only firestore:rules,storage:rules
```

The app enforces Google sign-in and optionally restricts by domain via `NEXT_PUBLIC_ALLOWED_GOOGLE_DOMAINS`.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions, please open an issue in the GitHub repository.

---

**Built with ❤️ for architects, engineers, and space planners**
