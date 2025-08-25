const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');

require('dotenv').config()

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors({
    origin: [
        'http://localhost:5173',
        'https://our-diary-e1561.web.app',
        'https://our-diary-e1561.firebaseapp.com/',
    ],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nmbltxr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// google gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

app.post('/generate', async (req, res) => {
    // Extract the user prompt from the request body
    const { prompt } = req.body;

    // Check if the prompt is provided
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    try {
        // Get the specified generative model
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-05-20" });

        // Generate content using the model and the user's prompt
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // Send the generated text back as a JSON response
        res.status(200).json({ text });
    } catch (error) {
        // Log and handle any errors during the AI generation process
        console.error('Error generating text:', error);
        res.status(500).json({ error: 'Failed to generate content.' });
    }
});

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// middlewares
const logger = (req, res, next) => {
    console.log('log: info', req.method, req.url);
    next();
}
const verifyToken = (req, res, next) => {
    const token = req.cookies?.token;
    // console.log('token in the middleware', token);

    // no token available
    if (!token) {
        console.log('no token');
        return res.status(401).send({ message: 'unauthorized access' })
    }

    // token available
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: 'unauthorized access' })
        }
        req.user = decoded;
        next();
    })
}

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const blogCollection = client.db('yourVoice').collection('allBlogs');

        // auth related api
        // creating cookie
        app.post('/jwt', logger, async (req, res) => {
            const user = req.body;
            console.log('user for token', user);
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })

            res
                .cookie('token', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
                })
                .send({ success: true });
        })

        // deleting cookie
        app.post('/logout', async (req, res) => {
            const user = req.body;
            console.log('logging out', user);
            res.clearCookie('token', { maxAge: 0 }).send({ success: true })
        })


        // all blogs api
        app.get('/allBlogs', async (req, res) => {
            const cursor = blogCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        })

        // recent blogs api
        app.get('/recent', async (req, res) => {
            const cursor = blogCollection.find().sort({ "time": -1 }).limit(2)
            const result = await cursor.toArray();
            res.send(result);
        })

        // featured blogs api
        app.get('/featured', async (req, res) => {
            const cursor = blogCollection.find().sort({ "time": -1 }).limit(4);
            const result = await cursor.toArray();
            res.send(result);
        })

        // get wishlists api
        app.get('/wishlist', logger, verifyToken, async (req, res) => {
            // checking token email and user email
            console.log(req.user.email);
            if (req.user.email !== req.query.email) {
                return res.status(403).send({ mesasge: 'forbidden access' })
            }
            console.log(req.query.email);
            query = { email: req.query.email }
            const result = await wishlistCollection.find(query).toArray();
            res.send(result);
        })
        // add wishlist api
        app.post('/wishlist', async (req, res) => {
            console.log('token owner info', req.user);
            const newWishlist = req.body;
            console.log(newWishlist);
            const result = await wishlistCollection.insertOne(newWishlist);
            res.send(result);
        })

        // a single blog details api
        app.get('/allBlogs/:id', logger, verifyToken, async (req, res) => {
            // if (!req.user.email) {
            //     return res.status(403).send({ mesasge: 'forbidden access' })
            // }
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await blogCollection.findOne(query);
            // const cursor = blogCollection.find();
            // const result = await cursor.toArray();
            res.send(result);
        })

        // title search api
        app.get('/search', async (req, res) => {
            console.log(req.query.title);
            const title = req.query.title;

            // Case-insensitive, partial match
            const query = { title: { $regex: title, $options: 'i' } };

            const result = await blogCollection.find(query).toArray();

            res.send(result);
        })
        // filter api
        app.get('/filter', async (req, res) => {
            console.log(req.query.filter);
            query = { category: req.query.filter }
            const result = await blogCollection.find(query).toArray();
            res.send(result);
        })

        // insert a new blog
        app.post('/addblogs', async (req, res) => {
            const newBlog = req.body;
            console.log(newBlog);
            const result = await blogCollection.insertOne(newBlog);
            res.send(result);
        })

        // insert a comment on a blog
        app.put('/addcomment/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true };
            const comment = req.body;
            const spot = {
                $push: {
                    comment: comment
                }
            }
            const result = await blogCollection.updateOne(filter, spot, options);
            res.send(result);
        })

        // update blog
        app.put('/update/:id', logger, verifyToken, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true };
            const updatedBlog = req.body;
            const spot = {
                $set: {
                    blogImage: updatedBlog.blogImage,
                    title: updatedBlog.title,
                    category: updatedBlog.category,
                    long_description: updatedBlog.long_description,
                    short_description: updatedBlog.short_description,
                    poster: updatedBlog.poster,
                }
            }
            const result = await blogCollection.updateOne(filter, spot, options);
            res.send(result);
        })


        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('your voice Server is running')
})

app.listen(port, () => {
    console.log(`your voice Server is running on port ${port}`)
})