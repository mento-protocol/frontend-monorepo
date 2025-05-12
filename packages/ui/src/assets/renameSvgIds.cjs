const fs = require("fs");
const path = require("path");

// Define the file path
const filePath = path.join(__dirname, "large-icons.svg");

// Read the SVG file
fs.readFile(filePath, "utf8", (err, data) => {
  if (err) {
    console.error("Error reading the file:", err);
    return;
  }

  // Replace all `id` attributes in <symbol> tags
  const updatedData = data.replace(/<symbol id="([^"]+)"/g, (match, id) => {
    // Remove "Property" and convert to snake_case
    const newId = id
      .replace(/Property\d*=/gi, "") // Remove "Property" and numbers
      .replace(/[^a-zA-Z0-9]+/g, "_") // Replace non-alphanumeric characters with underscores
      .toLowerCase(); // Convert to lower case
    return `<symbol id="${newId}"`;
  });

  // Write the updated SVG back to the file
  fs.writeFile(filePath, updatedData, "utf8", (err) => {
    if (err) {
      console.error("Error writing the file:", err);
      return;
    }
    console.log("SVG IDs have been updated successfully!");
  });
});
