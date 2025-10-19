# Fresh from the Fridge

## Inspiration
We thought that a common issue people may have is figuring out what to make for food based on the ingredients in a fridge. It can be time-consuming to figure out what a person may know how to make and to make sure they have the sufficient amount of ingredients. This is where our solution comes in, which creates many unique recipes based on data collected from your fridge. 

## What it does
Our solution involves a camera that analyzes the contents of a fridge using video processing, which is then used to itemize the contents of the fridge. Our solution utilizes the ingredients to output recipes that a person can make. Our solution also has the ability to process receipts to easily add a log of all the currenty groceries you have available. When these update, we also update the suggestions that are given to you based on what you have. 

## How we built it
Our solution involves an OpenMV camera, which incorporates a limit switch for the camera to understand when to start and stop recording the contents within a fridge. The embedded system programming was implemented using Python to create .mp4 files that are stored on Amazon S3 to store the ingredients. All of the processing happens in a set of AWS lambda functions that run when a video (from automatic camera) or a receipt is uploaded to the s3 bucket. For the video's we are using AWS Rekognition to extract item labels of what was put in the fridge. After we get these labels, we keep what it was at least 85% confident with and then need to further process those. To do this we make a simple structured call to an fast cheap llm to filter out any non grocery / fridge items. Once that is done the new items get added/updated in the AWS Aurora database. Once updated, new recipies are suggested based on what is currently available in the fridge. Receipts have a simmilar lambda workflow, intead we use textract to parse the item data from receipts and then that is sent to an llm to filter out items. The steps of updating the database and suggestions are the same as video.

### Recipe Suggestion Process (Embedding)
This was one of the harder portions of the implementation, while we could have done something a bit more lazy like simply AI generating a recipie based on what you have, instead we chose to take the hard route. Using a subset of 40k + recipies from an online dataset of food.com recipies, caused some serious processing to need to be done. We could do something like going through and prompting a fast llm to see if we have what was needed to make the recipie, but with such a large dataset it would be slow and very expensive. So instead we used embedding to preprocess our data. This way we only have some small cost when we first populate our database but then we can do very quick cheap lookups. We used the AWS 'amazon.titan-embed-text-v1' model, we made this choice since it was available through bedrock and cheap making it a good production long term implementation. The embedding model converts these ingredients to space vectors which can be compared against for similarity later. To suggest, when we get new data either video or photo, once tha database is updated with the new/removed items, then we regenerate the options. To do this we can use Cosine Similarity, along with an sql query. This then updates the suggested table in the database and links to the id in the main table, the suggested are then displayed to the user where they can choose what they want to make. 


## Challenges we ran into

## Accomplishments that we're pround of 

## What we learned

## What's next for Fresh from the Fridge!




