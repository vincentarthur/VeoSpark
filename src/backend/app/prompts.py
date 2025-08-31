IMAGE_ENRICHMENT_PROMPT_PREFIX = """
Act as an expert image analyst. Your task is to analyze the provided image with extreme detail and output your findings as a structured JSON object. Do not miss any details. Describe every element, including all subjects, objects, the environment, and the artistic properties of the image.

**Image:** """


IMAGE_ENRICHMENT_PROMPT_SUFFIX = """
**Output Format (JSON):**
{
  "summary": "A one-sentence summary of the image's overall content and mood.",
  "subjects_and_characters": [
    {
      "subject_id": 1,
      "type": "e.g., person, animal, creature, robot",
      "description": "Overall description of the subject.",
      "age_and_gender": "e.g., young adult female, elderly man, male child",
      "physical_appearance": {
        "face": "Detailed description of facial structure, features, and skin.",
        "hair": "Detailed description of hairstyle, color, texture, and length.",
        "body": "Description of build, posture, and any notable physical features."
      },
      "clothing_and_accessories": "A meticulous breakdown of every item of clothing, anaylzing style, fabric, color, and fit. Describe all accessories like jewelry, glasses, hats, or bags.",
      "pose_and_expression": "Detailed analysis of body language, pose, facial expression, and gaze. What emotion is being conveyed?"
    }
  ],
  "environment_and_setting": {
    "location": "e.g., dense forest, futuristic city street, minimalist studio, cluttered bedroom",
    "time_of_day": "e.g., golden hour sunset, bright midday, twilight, dead of night.",
    "weather": "e.g., clear skies, overcast, rainy, misty, snowy.",
    "foreground_elements": "List and describe all objects and details in the foreground.",
    "background_elements": "List and describe all objects, scenery, and details in the background."
  },
  "technical_details": {
    "artistic_style_and_medium": {
      "medium": "e.g., digital photograph, oil painting, 3D render, watercolor, charcoal sketch. [14]",
      "style": "e.g., photorealistic, hyperrealistic, impressionism, cyberpunk, art deco, anime, fantasy art. [6, 12]",
      "artist_influences": "If the style resembles a famous artist or movement, mention it here (e.g., 'in the style of Van Gogh')."
    },
    "composition_and_framing": {
      "shot_type": "e.g., extreme close-up, close-up portrait, medium shot, full-body shot, wide shot, landscape. [6]",
      "camera_angle": "e.g., eye-level, low-angle, high-angle, overhead shot, dutch angle.",
      "focus_and_depth_of_field": "e.g., tack sharp focus on the subject, shallow depth of field with a blurry bokeh background, deep focus with everything sharp."
    },
    "lighting": {
      "style": "e.g., soft cinematic lighting, hard dramatic shadows, natural sunlight, studio lighting, neon glow. [6, 13]",
      "source_and_direction": "e.g., single light source from the top-left, backlit by the sun, multiple ambient light sources.",
      "temperature_and_color": "e.g., warm golden light, cool blue tones, vibrant multicolored lighting."
    },
    "color_palette": {
      "dominant_colors": ["List of main colors as hex codes or names."],
      "accent_colors": ["List of secondary, standout colors."],
      "harmony": "e.g., monochromatic, analogous, complementary, triadic, vibrant, muted."
    }
  },
  "mood_and_atmosphere": "Describe the overall feeling or emotion the image evokes (e.g., serene and peaceful, tense and mysterious, energetic and joyful, nostalgic and melancholic)."
}
"""


IMAGE_ENRICHMENT_PROMPT_COMBINATION = """
# ROLE AND GOAL
You are an expert Visual Scene Editor. Your task is to intelligently modify a detailed JSON image description (`IMAGE_DESCRIPTION`) based on a user's modification request (`CUST_INPUT`). Your goal is to seamlessly integrate the user's request into the description, creating a new, coherent, and logically consistent scene while strictly preserving the original JSON structure.

# INSTRUCTIONS

1.  **Analyze the Request:** Carefully examine the `CUST_INPUT` to understand the core change. Identify the primary element to be modified (e.g., the main character, the background, the artistic style, an object).

2.  **Identify Target Fields:** Scan the entire `IMAGE_DESCRIPTION` JSON. Pinpoint all the fields and nested values that describe the element you identified in Step 1. The most obvious target might be in `subjects_and_characters`, but related descriptions could also be in `summary`, `clothing_and_accessories`, `pose_and_expression`, and even influence `mood_and_atmosphere` or `color_palette`.

3.  **Perform Creative Integration:**
    *   Rewrite the content of the identified target fields to reflect the `CUST_INPUT`.
    *   **Do not just paste**. You must creatively and logically adapt the new element to the existing scene. For instance, if replacing a character in an underwater scene with Spider-Man, describe how his suit might look wet, how his pose would adapt to being underwater (e.g., a dynamic swimming or web-swinging pose, even if unrealistic), and how the underwater lighting would reflect off his suit.
    *   Infer and generate new, appropriate details for the replaced element. Describe the new subject with the same level of detail as the original.

4.  **Ensure Global Consistency:** After modifying the primary fields, review and update other related parts of the JSON to ensure the entire description is coherent.
    *   **`summary`**: Must be updated to accurately reflect the new scene.
    *   **`mood_and_atmosphere`**: Adjust if the new element changes the overall feeling (e.g., Spider-Man might introduce a more "heroic" or "acrobatic" mood).
    *   **`color_palette`**: Add or change dominant/accent colors if necessary (e.g., add red and blue for Spider-Man).
    *   **Interactions**: Ensure the new element logically fits within the `environment_and_setting`.

5.  **Strictly Maintain Format:** This is the most critical rule. The output **MUST** be a valid JSON object. You must not add, remove, or rename any keys from the original `IMAGE_DESCRIPTION` structure. You are only allowed to change the string values within the keys.

# INPUTS

<IMAGE_DESCRIPTION>
{image_description_json}
</IMAGE_DESCRIPTION>

<CUST_INPUT>
{cust_input_text}
</CUST_INPUT>

# OUTPUT
Now, based on the instructions, process the inputs and generate the new, updated `IMAGE_DESCRIPTION` JSON.
"""
