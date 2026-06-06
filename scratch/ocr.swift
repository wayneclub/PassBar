import Foundation
import Vision
import AppKit

func performOCR(imagePath: String) {
    let url = URL(fileURLWithPath: imagePath)
    guard let image = NSImage(contentsOf: url) else {
        print("Failed to load image")
        return
    }
    
    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("Failed to get CGImage")
        return
    }
    
    let requestHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    let request = VNRecognizeTextRequest { request, error in
        if let error = error {
            print("OCR error: \(error)")
            return
        }
        
        guard let observations = request.results as? [VNRecognizedTextObservation] else {
            print("No text recognized")
            return
        }
        
        for observation in observations {
            guard let topCandidate = observation.topCandidates(1).first else { continue }
            print(topCandidate.string)
        }
    }
    
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    
    do {
        try requestHandler.perform([request])
    } catch {
        print("Unable to perform OCR request: \(error)")
    }
}

let arguments = CommandLine.arguments
if arguments.count > 1 {
    performOCR(imagePath: arguments[1])
} else {
    print("Please provide an image path")
}
