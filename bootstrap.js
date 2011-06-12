/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Dominant Color.
 *
 * The Initial Developer of the Original Code is Edward Lee.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Edward Lee <edilee@gmail.com>
 *   Margaret Leibovic <margaret.leibovic@gmail.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";
const global = this;

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Services.jsm");

// Take pixel data for an image and find the dominant color
function processPixels(pixels) {
  // Keep track of how many times a color appears in the image
  let colorCount = {};
  let dominantColor = "";
  let maxCount = 0;

  // Process each pixel one by one
  pixels.forEach(function(data) {
    // Round the color values to the closest multiple of 8
    let [red, green, blue, alpha] = data.map(function(v) Math.round(v / 8) * 8);

    // Ignore transparent pixels
    if (alpha <= 40)
      return;

    // Ignore black-ish and white-ish
    if (Math.max(red, green, blue) <= 40 || Math.min(red, green, blue) >= 216)
      return;

    // Increment or initialize the counter
    let color = red + "," + green + "," + blue;
    colorCount[color] = (colorCount[color] || 0) + 1;

    // Keep track of the color that appears the most times
    if (colorCount[color] > maxCount) {
      maxCount = colorCount[color];
      dominantColor = color;
    }
  });

  // Break the color into rgb pieces
  return dominantColor.split(",");
}

// Add the functionality to detect images and compute the color
function addFindDominant(window) {
  let {async, createNode} = makeWindowHelpers(window);
  let {document} = window;

  // Compute the dominant color for a xhtml:img element
  function getDominantColor(image) {
    let canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    let {height, width} = image;
    canvas.height = height;
    canvas.width = width;

    let context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);

    // Get the rgba pixel values as 4 one-byte values
    let {data} = context.getImageData(0, 0, height, width);

    // Group each set of 4 bytes into pixels
    let pixels = [];
    for (let i = 0; i < data.length; i += 4)
      pixels.push(Array.slice(data, i, i + 4));

    return processPixels(pixels);
  }

  // Create a panel to show the image and dominant color
  let panel = createNode("panel");
  document.getElementById("mainPopupSet").appendChild(panel);
  panel.setAttribute("noautofocus", true);

  // Provide a way to show the color value
  let label = createNode("label");
  panel.appendChild(label);

  // Add some space to show off the color
  let box = createNode("box");
  panel.appendChild(box);
  box.style.padding = "30px";

  // Display the image in the center
  let display = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
  box.appendChild(display);
  display.style.display = "block";

  // Watch for the panel to appear and wait briefly before coloring
  display.addEventListener("load", function() {
    let color = getDominantColor(display);
    function rgb(a) "rgba(" + color + "," + a +")";

    label.setAttribute("value", color);

    // Set a radial gradient that makes use of the dominant color
    let gradient = ["top left", "farthest-corner", rgb(.3), rgb(.5)];
    box.style.backgroundImage = "-moz-radial-gradient(" + gradient + ")";

    // Add a border with the dominant color
    box.style.boxShadow = "0 0 20px " + rgb(1) + " inset";
  }, false);

  // Hide the panel on click
  panel.addEventListener("mousedown", function() {
    panel.hidePopup();
  }, false);

  // Use whatever image that the user points at
  listen(window, window, "mousemove", function({originalTarget, shiftKey}) {
    // Only bother if shift is being held
    if (!shiftKey)
      return;

    // Get the full url from the computed style
    function getImageUrl(style) {
      let computed = window.getComputedStyle(originalTarget);
      let match = computed[style].match(/^url\("?([^)]+?)"?\)$/);
      return match == null ? "" : match[1];
    }

    // Read out the src value for xul:image and xhtml:img
    let {nodeName, parentNode, src} = originalTarget;
    let image = "";
    if (nodeName.search(/(image|img)$/i) != -1)
      image = src;

    // Try getting various css image url values
    image = image || getImageUrl("backgroundImage");
    image = image || getImageUrl("listStyleImage");

    // Might be pointing at a tab, so try reading out that value
    if (image == "") {
      try {
        image = parentNode.getAttribute("image") || "";
      }
      catch(ex) {}
    }

    // Stil nothing? Abort!
    if (image == "")
      return;

    // Don't bother if we have the same image
    if (display.getAttribute("src") == image)
      return;

    // Close the panel so that it'll open in the right spot
    if (panel.state == "open")
      panel.hidePopup();

    // Update the image and show it
    display.setAttribute("src", image);
    panel.openPopup(originalTarget);
  });

  // Make sure to clean up the added panel
  unload(function() panel.parentNode.removeChild(panel), window);
}

/**
 * Handle the add-on being activated on install/enable
 */
function startup({id}) AddonManager.getAddonByID(id, function(addon) {
  // Load various javascript includes for helper functions
  ["helper", "utils"].forEach(function(fileName) {
    let fileURI = addon.getResourceURI("scripts/" + fileName + ".js");
    Services.scriptloader.loadSubScript(fileURI.spec, global);
  });

  // Prepare to get the dominant color
  watchWindows(addFindDominant);
})


/**
 * Handle the add-on being deactivated on uninstall/disable
 */
function shutdown(data, reason) {
  // Clean up with unloaders when we're deactivating
  if (reason != APP_SHUTDOWN)
    unload();
}

/**
 * Handle the add-on being installed
 */
function install(data, reason) {}

/**
 * Handle the add-on being uninstalled
 */
function uninstall(data, reason) {}
