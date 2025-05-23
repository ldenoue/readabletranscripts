# Scribe - Beautiful YouTube Transcripts with Gemini 1.5 Flash 8B LLM

This repo shows how to fetch the raw YouTube transcripts and use the Gemini Flash 8B API to format them.
Made by [@ldenoue](https://twitter.com/ldenoue)

# How to use

The demo at https://ldenoue.github.io/readabletranscripts lists sample videos in case you don't have or want to enter your Gemini API key.

I also offer this LLM-based Pro version at https://www.appblit.com/scribe and you get 120 free minutes on signup.

Developers, try locally `python3 -m http.server` and open `http://localhost:8000`

Set your Gemini API KEY (create a [Free Gemini API Key](https://aistudio.google.com/apikey))
Note: The key is used https://github.com/ldenoue/readabletranscripts/blob/f5ea5804ed7fb5570be780129c7d21e7a1b367e5/code.js#L159 to fetch Gemini's answers from your browser.
It is never uploaded anywhere.

Click on the video, e.g. https://ldenoue.github.io/readabletranscripts/?id=8yzmCt0QwOQ

You will see a summary of the video and the transcript below.

# How it is done

## Getting vocabulary words from the title and video description

We first ask Gemini to extract important words by giving it the video title and its description.
See https://github.com/ldenoue/readabletranscripts/blob/8466ec2f0426964933ad02e4db93e2d51fc4776f/code.js#L837

This context is essential to improve the accuracy of the transcripts.
Titles and descriptions often contain human-edited text that includes proper names, acronyms, etc.

## Breaking the transcript into chunks
We break up the raw YouTube transcript into chunks of 512 words.
We feed each chunk to Gemini with a prompt (see https://github.com/ldenoue/readabletranscripts/blob/5c51f5298f9f39bc2f35a94b84baa95fa95408bd/code.js#L410)

Notice that we send the requests in parallel to Gemini.

## Merging sentences at the boundary between 2 chunks
Once we have the formatted chunks, we now need to merge them.
For each 2 consecutive chunks `chunk1` and `chunk2`, we ask Gemini to merge the last sentence `chunk1` and the first sentence of `chunk2` (see prompt in https://github.com/ldenoue/readabletranscripts/blob/5c51f5298f9f39bc2f35a94b84baa95fa95408bd/code.js#L433)

We merge the chunks and the seams between them to obtain the final transcript.

## Linking the raw YouTube timestamps with the final transcript

In order to highlight the words as the video plays, we need to align the words from the raw YouTube transcript and the final, punctuated, transcript.

We rely on `diff.js` for that.

Now words get highlighted as the video plays, and users can also jump into the video by clicking any word in the transcript.

## Help me improve this tool

Thanks for your contribution.

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/ldenoue)
