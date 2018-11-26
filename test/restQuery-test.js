/*
	Rest Query

	Copyright (c) 2014 - 2018 Cédric Ronvel

	The MIT License (MIT)

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in all
	copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	SOFTWARE.
*/

/* global describe, it, before, after, beforeEach, expect */

"use strict" ;



var cliOptions = getCliOptions() ;

var restQuery = require( '..' ) ;

var Logfella = require( 'logfella' ) ;

if ( cliOptions.overrideConsole === undefined ) { cliOptions.overrideConsole = false ; }
if ( ! cliOptions.log ) { cliOptions.log = { minLevel: 4 } ; }
var log = Logfella.global.use( 'unit-test' ) ;

var async = require( 'async-kit' ) ;
var Promise = require( 'seventh' ) ;

var tree = require( 'tree-kit' ) ;
var string = require( 'string-kit' ) ;
var ErrorStatus = require( 'error-status' ) ;
var rootsDb = require( 'roots-db' ) ;

var mongodb = require( 'mongodb' ) ;

var doormen = require( 'doormen' ) ;

var fsKit = require( 'fs-kit' ) ;
var hash = require( 'hash-kit' ) ;





// Collections...
var blogs , posts , comments ;





/* Utils */



// it flatten prototype chain, so a single object owns every property of its parents
var protoflatten = tree.extend.bind( undefined , { deep: true , immutables: [ mongodb.ObjectID.prototype ] } , null ) ;



// Return options while trying to avoid mocha's parameters
function getCliOptions() {
	var i , max = 0 ;

	for ( i = 2 ; i < process.argv.length ; i ++ ) {
		if ( process.argv[ i ].match( /\*|.+\.js/ ) ) {
			max = i ;
		}
	}

	return require( 'minimist' )( process.argv.slice( max + 1 ) ) ;
}



function clearCollection( collection ) {
	return collection.driver.rawInit()
		.then( () => collection.driver.raw.deleteMany( {} ) )
		.then( () => {
			if ( ! collection.attachmentUrl ) { return ; }
			return Promise.promisify( fsKit.deltree , fsKit )( collection.attachmentUrl ) ;
		} ) ;
}



var currentApp ;

async function commonApp() {
	if ( currentApp ) { currentApp.shutdown() ; }

	var app = new restQuery.App( __dirname + '/../sample.kfg/main.kfg' , cliOptions ) ;

	// Create a system performer
	var performer = app.createPerformer( null , true ) ;

	currentApp = app ;

	await Promise.all( [
		clearCollection( app.collectionNodes.users.collection ) ,
		clearCollection( app.collectionNodes.groups.collection ) ,
		clearCollection( app.collectionNodes.blogs.collection ) ,
		clearCollection( app.collectionNodes.posts.collection ) ,
		clearCollection( app.collectionNodes.comments.collection )
	] ) ;
	
	try {
		await app.buildIndexes() ;
	}
	catch ( error ) {
		debugger ;
		throw error ;
	}
	
	return { app , performer } ;
}



// Legacy
function _commonApp( callback ) {
	commonApp().then(
		v => callback( undefined , v.app , v.performer ) ,
		error => callback( error )
	) ;
}





/* Tests */



describe( "App config" , () => {

	// Nothing special to test here: the whole test would fail if it wasn't working...
	// Finer tests should be done later.
	it( "Test loading a full config" , () => {} ) ;
} ) ;



describe( "Basic queries of object of a top-level collection" , () => {

	it( "GET on the root object" , async () => {
		var { app , performer } = await commonApp() ;
		var response = await app.get( '/' , { performer: performer } ) ;
		expect( response.output.data ).to.equal( {
			bob: 'dans le geth\'',
			userAccess: {},
			groupAccess: {},
			publicAccess: { traverse: 1, read: 3, create: 1 }
		} ) ;
	} ) ;
	
	it( "GET on an unexisting item" , async () => {
		var { app , performer } = await commonApp() ;
		await expect( () => app.get( '/Blogs/111111111111111111111111' , { performer: performer } ) ).to.reject( ErrorStatus , { type: 'notFound' , httpStatus: 404 } ) ;
	} ) ;

	it( "GET on a regular item" , async () => {
		var { app , performer } = await commonApp() ;

		var blog = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;
		
		await blog.save() ;
		var response = await app.get( '/Blogs/' + blog.getId() , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( { title: 'My wonderful life' , description: 'This is a supa blog!' } ) ;
	} ) ;

	it( "GET on a property of a regular item" , async () => {
		var { app , performer } = await commonApp() ;

		var randomId = new mongodb.ObjectID() ,
			userAccess = {} ;
		
		userAccess[ randomId ] = 'read' ;	// Random unexistant ID

		var blog = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all' ,
			userAccess: userAccess
		} ) ;
		
		await blog.save() ;
		
		var response = await app.get( '/Blogs/' + blog.getId() + '/.title' , { performer: performer } ) ;
		expect( response.output.data ).to.be( 'My wonderful life' ) ;
		
		response = await app.get( '/Blogs/' + blog.getId() + '/.userAccess.' + randomId , { performer: performer } ) ;
		expect( response.output.data ).to.equal( { traverse: 1 , read: 3 } ) ;
	} ) ;

	it( "POST then GET" , async () => {
		var { app , performer } = await commonApp() ;
		
		var response = await app.post(
			'/Blogs' ,
			{
				title: 'My wonderful life posted!!!' ,
				description: 'This is a supa blog! (posted!)' ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		var id = response.output.data.id.toString() ;
		expect( id ).to.be.a( 'string' ) ;
		expect( id ).to.have.length.of( 24 ) ;
		
		response = await app.get( '/Blogs/' + id , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			title: 'My wonderful life posted!!!' ,
			description: 'This is a supa blog! (posted!)' ,
			parent: { id: '/' , collection: null }
		} )
	} ) ;

	it( "PUT then GET" , async () => {
		var { app , performer } = await commonApp() ;
		
		var response = await app.put( '/Blogs/5437f846c41d0e910ec9a5d8' ,
			{
				title: 'My wonderful life 2!!!' ,
				description: 'This is a supa blog! (x2)' ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;

		response = await app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			title: 'My wonderful life 2!!!' ,
			description: 'This is a supa blog! (x2)' ,
			parent: { id: '/' , collection: null }
		} ) ;
	} ) ;

	it( "PUT, then PUT (overwrite), then GET" , async () => {
		var { app , performer } = await commonApp() ;

		var response = app.put( '/Blogs/5437f846c41d0e910ec9a5d8' ,
			{
				title: 'My wonderful life 3!!!' ,
				description: 'This is a supa blog! (x3)' ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		response = await app.put( '/Blogs/5437f846c41d0e910ec9a5d8' ,
			{
				title: 'My wonderful life 3!!!' ,
				description: 'This is a supa blog! Now overwritten!' ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		response = await app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: performer } ) ;
		
		expect( response.output.data ).to.partially.equal( {
			title: 'My wonderful life 3!!!' ,
			description: 'This is a supa blog! Now overwritten!' ,
			parent: { id: '/' , collection: null }
		} ) ;
	} ) ;

	it( "PATCH on an unexisting item" , async () => {
		var { app , performer } = await commonApp() ;

		await expect( () => app.patch( '/Blogs/111111111111111111111111' , { description: 'Oh yeah!' } , null , { performer: performer } ) )
			.to.reject( ErrorStatus , { type: 'notFound', httpStatus: 404 } ) ;
	} ) ;

	it( "PUT, then PATCH, then GET (featuring embedded data)" , async () => {
		var { app , performer } = await commonApp() ;

		var response = await app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
				title: 'My wonderful life 3!!!' ,
				description: 'This is a supa blog! (x3)' ,
				embedded: { a: 'a' , b: 'b' } ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		response = await app.patch( '/Blogs/5437f846c41d0e910ec9a5d8' , {
				description: 'This is a supa blog! Now patched!' ,
				"embedded.a": 'A' ,
				parent: "should not overwrite" ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		response = await app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			title: 'My wonderful life 3!!!' ,
			description: 'This is a supa blog! Now patched!' ,
			embedded: { a: 'A' , b: 'b' } ,
			parent: { id: '/' , collection: null }
		} ) ;
	} ) ;

	it( "PUT, then PATCH on a property, then GET (featuring embedded data)" , async () => {
		var { app , performer } = await commonApp() ;
		
		var response = await app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
				title: 'My wonderful life 3!!!' ,
				description: 'This is a supa blog! (x3)' ,
				embedded: { a: 'a' , b: 'b' } ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		response = await app.patch( '/Blogs/5437f846c41d0e910ec9a5d8/.embedded' , { a: 'omg' } , null , { performer: performer } ) ;
		
		response = await app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: performer } ) ;
		
		expect( response.output.data ).to.partially.equal( {
			title: 'My wonderful life 3!!!' ,
			description: 'This is a supa blog! (x3)' ,
			embedded: { a: 'omg' , b: 'b' } ,
			parent: { id: '/' , collection: null }
		} ) ;
	} ) ;

	it( "PUT, then PUT (overwrite) on a property, then GET" , async () => {
		var { app , performer } = await commonApp() ;

		var response = await app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
				title: 'My wonderful life 3!!!' ,
				description: 'This is a supa blog! (x3)' ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		response = await app.put( '/Blogs/5437f846c41d0e910ec9a5d8/.title' , "Change dat title." , null , { performer: performer } ) ;
		
		response = await app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: performer } ) ;

		expect( response.output.data ).to.partially.equal( {
			title: 'Change dat title.' ,
			description: 'This is a supa blog! (x3)' ,
			parent: { id: '/' , collection: null } ,
		} ) ;
	} ) ;

	it( "DELETE on an unexisting item" , async () => {
		var { app , performer } = await commonApp() ;
		await expect( () => app.delete( '/Blogs/111111111111111111111111' , { performer: performer } ) ).to.reject( ErrorStatus , { type: 'notFound', httpStatus: 404 } ) ;
	} ) ;

	it( "PUT, then DELETE, then GET" , async () => {
		var { app , performer } = await commonApp() ;

		var response = await app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
				title: 'My wonderful life 2!!!' ,
				description: 'This is a supa blog! (x2)' ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		response = await app.delete( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: performer } ) ;
		
		await expect( () => app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: performer } ) ).to.reject( ErrorStatus , { type: 'notFound', httpStatus: 404 } ) ;
	} ) ;

	it( "DELETE on a property of an object" ) ;
	it( "DELETE should recursively delete all children [NOT CODED ATM]" ) ;
} ) ;



describe( "Basic queries of top-level collections" , () => {

	it( "GET on an empty collection" , async () => {
		var { app , performer } = await commonApp() ;
		var response = await app.get( '/Blogs' , { performer: performer } ) ;
		expect( response.output.data ).to.equal( [] ) ;
	} ) ;

	it( "GET on a collection with items" , async () => {
		var { app , performer } = await commonApp() ;

		var blog1 = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;
		
		await blog1.save() ;
		
		var blog2 = app.root.children.blogs.collection.createDocument( {
			title: 'YAB' ,
			description: 'Yet Another Blog' ,
			publicAccess: 'all'
		} ) ;
		
		await blog2.save() ;
		
		var response = await app.get( '/Blogs' , { performer: performer } ) ;
		expect( response.output.data ).to.equal( [
			{
				title: 'My wonderful life' ,
				description: 'This is a supa blog!' ,
				_id: blog1.getId() ,
				//embedded: undefined,
				parent: { id: '/' , collection: null } ,
				userAccess: {} ,
				groupAccess: {} ,
				publicAccess: {
					traverse: 1 , read: 5 , write: 5 , delete: 1 , create: 1
				} ,
				slugId: response.output.data[ 0 ].slugId		// cannot be predicted
			} ,
			{
				title: 'YAB' ,
				description: 'Yet Another Blog' ,
				_id: blog2.getId() ,
				//embedded: undefined,
				parent: { id: '/' , collection: null } ,
				userAccess: {} ,
				groupAccess: {} ,
				publicAccess: {
					traverse: 1 , read: 5 , write: 5 , delete: 1 , create: 1
				} ,
				slugId: response.output.data[ 1 ].slugId		// cannot be predicted
			}
		] ) ;
	} ) ;

	it( "GET on a collection with items, with special query: skip, limit, sort and filter" , async () => {
		var { app , performer } = await commonApp() ;
		
		var blog1 = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;
		
		await blog1.save() ;
		
		var blog2 = app.root.children.blogs.collection.createDocument( {
			title: 'YAB' ,
			description: 'Yet Another Blog' ,
			publicAccess: 'all'
		} ) ;
		
		await blog2.save() ;
		
		var blog3 = app.root.children.blogs.collection.createDocument( {
			title: 'Third' ,
			description: 'The Third' ,
			publicAccess: 'all'
		} ) ;
		
		await blog3.save() ;
		
		var response = await app.get( '/Blogs' , { performer: performer , input: { query: { limit: 2 } } } ) ;
		expect( response.output.data ).to.equal( [
			{
				title: 'My wonderful life',
				description: 'This is a supa blog!',
				_id: blog1.getId(),
				//embedded: undefined,
				parent: { id: '/', collection: null },
				userAccess: {},
				groupAccess: {},
				publicAccess: { traverse: 1, read: 5, write: 5, delete: 1, create: 1 },
				slugId: response.output.data[ 0 ].slugId		// cannot be predicted
			} ,
			{
				title: 'YAB' ,
				description: 'Yet Another Blog' ,
				_id: blog2.getId(),
				//embedded: undefined,
				parent: { id: '/', collection: null },
				userAccess: {},
				groupAccess: {},
				publicAccess: { traverse: 1, read: 5, write: 5, delete: 1, create: 1 },
				slugId: response.output.data[ 1 ].slugId		// cannot be predicted
			}
		] ) ;
		
		response = await app.get( '/Blogs' , { performer: performer , input: { query: { skip: 1 } } } ) ;
		expect( response.output.data ).to.equal( [
			{
				title: 'YAB' ,
				description: 'Yet Another Blog' ,
				_id: blog2.getId(),
				//embedded: undefined,
				parent: { id: '/', collection: null },
				userAccess: {},
				groupAccess: {},
				publicAccess: { traverse: 1, read: 5, write: 5, delete: 1, create: 1 },
				slugId: response.output.data[ 0 ].slugId		// cannot be predicted
			} ,
			{
				title: 'Third' ,
				description: 'The Third' ,
				_id: blog3.getId(),
				//embedded: undefined,
				parent: { id: '/', collection: null },
				userAccess: {},
				groupAccess: {},
				publicAccess: { traverse: 1, read: 5, write: 5, delete: 1, create: 1 },
				slugId: response.output.data[ 1 ].slugId		// cannot be predicted
			}
		] ) ;
		
		response = await app.get( '/Blogs' , { performer: performer , input: { query: { limit: 2 , sort: { title: 1 } } } } ) ;
		expect( response.output.data ).to.equal( [
			{
				title: 'My wonderful life',
				description: 'This is a supa blog!',
				_id: blog1.getId(),
				//embedded: undefined,
				parent: { id: '/', collection: null },
				userAccess: {},
				groupAccess: {},
				publicAccess: { traverse: 1, read: 5, write: 5, delete: 1, create: 1 },
				slugId: response.output.data[ 0 ].slugId		// cannot be predicted
			} ,
			{
				title: 'Third' ,
				description: 'The Third' ,
				_id: blog3.getId(),
				//embedded: undefined,
				parent: { id: '/', collection: null },
				userAccess: {},
				groupAccess: {},
				publicAccess: { traverse: 1, read: 5, write: 5, delete: 1, create: 1 },
				slugId: response.output.data[ 1 ].slugId		// cannot be predicted
			}
		] ) ;
		
		response = await app.get( '/Blogs' , { performer: performer , input: { query: { filter: { title: 'Third' } } } } ) ;
		expect( response.output.data ).to.equal( [
			{
				title: 'Third' ,
				description: 'The Third' ,
				_id: blog3.getId(),
				//embedded: undefined,
				parent: { id: '/', collection: null },
				userAccess: {},
				groupAccess: {},
				publicAccess: { traverse: 1, read: 5, write: 5, delete: 1, create: 1 },
				slugId: response.output.data[ 0 ].slugId		// cannot be predicted
			}
		] ) ;
	} ) ;
} ) ;



describe( "Built-in collection method: SCHEMA" , () => {

	it( "should get the schema of the collection" , async () => {
		var { app , performer } = await commonApp() ;
		var response = await app.get( '/Blogs/SCHEMA' , { performer: performer } ) ;
		expect( response.output.data ).to.equal( app.collectionNodes.blogs.schema ) ;
	} ) ;

	it( "should get the schema of the object" , async () => {
		var { app , performer } = await commonApp() ;
		
		var blog = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;
		
		await blog.save() ;
		
		var response = await app.get( '/Blogs/' + blog.getId() + '/SCHEMA' , { performer: performer } ) ;
		expect( response.output.data ).to.equal( app.collectionNodes.blogs.schema ) ;
	} ) ;
} ) ;



describe( "Queries of nested object" , () => {

	it( "GET on an unexisting nested item" , async () => {
		var { app , performer } = await commonApp() ;
		await expect( () => app.get( '/Blogs/111111111111111111111111/Posts/111111111111111111111111' , { performer: performer } ) )
			.to.reject( ErrorStatus , { type: 'notFound' , httpStatus: 404 } ) ;
	} ) ;

	it( "GET on a regular nested item" , async () => {
		var { app , performer } = await commonApp() ;
		
		var blog = await app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;
		
		await blog.save() ;
		
		var post = await app.root.children.blogs.children.posts.collection.createDocument( {
			title: 'My first post!' ,
			content: 'Blah blah blah.' ,
			parent: { collection: 'blogs' , id: blog.getId() } ,
			publicAccess: 'all'
		} ) ;
		
		await post.save() ;
		
		var response = await app.get( '/Blogs/' + blog.getId() + '/Posts/' + post.getId() , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			title: 'My first post!' ,
			content: 'Blah blah blah.'
		} ) ;
	} ) ;

	it( "GET on an existed nested item with bad ancestry chain" , async () => {
		var { app , performer } = await commonApp() ;

		var blog = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;
		
		await blog.save() ;
		
		var anotherBlog = app.root.children.blogs.collection.createDocument( {
			title: 'Another blog' ,
			description: 'Oh yeah' ,
			publicAccess: 'all'
		} ) ;
		
		await anotherBlog.save() ;
		
		var post = app.root.children.blogs.children.posts.collection.createDocument( {
			title: 'My second post!' ,
			content: 'Blah blah blah.' ,
			parent: { collection: 'blogs' , id: blog.getId() } ,
			publicAccess: 'all'
		} ) ;

		await post.save() ;
		
		var response = await app.get( '/Blogs/' + blog.getId() + '/Posts/' + post.getId() , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			title: 'My second post!' ,
			content: 'Blah blah blah.'
		} ) ;
		
		await expect( () => app.get( '/Blogs/' + anotherBlog.getId() + '/Posts/' + post.getId() , { performer: performer } ) )
			.to.reject( ErrorStatus , { type: 'notFound' , httpStatus: 404 } ) ;
	} ) ;

	it( "GET on a regular nested² item" , async () => {
		var { app , performer } = await commonApp() ;

		var blog = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;

		await blog.save() ;
		
		var post = app.root.children.blogs.children.posts.collection.createDocument( {
			title: 'My first post!' ,
			content: 'Blah blah blah.' ,
			parent: { collection: 'blogs' , id: blog.getId() } ,
			publicAccess: 'all'
		} ) ;

		await post.save() ;
		
		var comment = app.root.children.blogs.children.posts.children.comments.collection.createDocument( {
			title: 'nope!' ,
			content: 'First!' ,
			parent: { collection: 'posts' , id: post.getId() } ,
			publicAccess: 'all'
		} ) ;

		await comment.save() ;

		var response = await app.get( '/Blogs/' + blog.getId() + '/Posts/' + post.getId() + '/Comments/' + comment.getId() , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( { title: 'nope!' , content : 'First!' } ) ;
	} ) ;

	it( "GET on a regular nested² item with bad ancestry chain" , async () => {
		var { app , performer } = await commonApp() ;
		
		var blog = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;

		await blog.save() ;
		
		var anotherBlog = app.root.children.blogs.collection.createDocument( {
			title: 'Another blog' ,
			description: 'Oh yeah' ,
			publicAccess: 'all'
		} ) ;

		await anotherBlog.save() ;
		
		var post = app.root.children.blogs.children.posts.collection.createDocument( {
			title: 'My first post!' ,
			content: 'Blah blah blah.' ,
			parent: { collection: 'blogs' , id: blog.getId() } ,
			publicAccess: 'all'
		} ) ;

		await post.save() ;
		
		var anotherPost = app.root.children.blogs.children.posts.collection.createDocument( {
			title: 'My second post!' ,
			content: 'Blih blih blih.' ,
			parent: { collection: 'blogs' , id: blog.getId() } ,
			publicAccess: 'all'
		} ) ;

		await anotherPost.save() ;
		
		var comment = app.root.children.blogs.children.posts.children.comments.collection.createDocument( {
			title: 'nope!' ,
			content: 'First!' ,
			parent: { collection: 'posts' , id: post.getId() } ,
			publicAccess: 'all'
		} ) ;
		
		await comment.save() ;
		
		var response = await app.get( '/Blogs/' + blog.getId() + '/Posts/' + post.getId() + '/Comments/' + comment.getId() , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( { title: 'nope!' , content: 'First!' } ) ;
		
		await expect( () => app.get( '/Blogs/' + anotherBlog.getId() + '/Posts/' + post.getId() + '/Comments/' + comment.getId() , { performer: performer } ) )
			.to.reject( ErrorStatus , { type: 'notFound' , httpStatus: 404 } ) ;
		
		response = await app.get( '/Blogs/' + blog.getId() + '/Posts/' + anotherPost.getId() , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( { title: 'My second post!' , content: 'Blih blih blih.' } ) ;
		
		await expect( () => app.get( '/Blogs/' + blog.getId() + '/Posts/' + anotherPost.getId() + '/Comments/' + comment.getId() , { performer: performer } ) )
			.to.reject( ErrorStatus , { type: 'notFound' , httpStatus: 404 } ) ;
	} ) ;

	it( "GET a nested collection" , async () => {
		var { app , performer } = await commonApp() ;
		
		var blog = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;

		await blog.save() ;
		
		var anotherBlog = app.root.children.blogs.collection.createDocument( {
			title: 'Another blog' ,
			description: 'Oh yeah' ,
			publicAccess: 'all'
		} ) ;

		await anotherBlog.save() ;
		
		var post1 = app.root.children.blogs.children.posts.collection.createDocument( {
			title: 'My first post!' ,
			content: 'Blah blah blah.' ,
			parent: { collection: 'blogs' , id: blog.getId() } ,
			publicAccess: 'all'
		} ) ;

		await post1.save() ;
		
		var post2 = app.root.children.blogs.children.posts.collection.createDocument( {
			title: 'My second post!' ,
			content: 'Hi ho!' ,
			parent: { collection: 'blogs' , id: blog.getId() } ,
			publicAccess: 'all'
		} ) ;

		await post2.save() ;
		
		var postAlt = app.root.children.blogs.children.posts.collection.createDocument( {
			title: 'My alternate post!' ,
			content: 'It does not belong to the same blog!' ,
			parent: { collection: 'blogs' , id: anotherBlog.getId() } ,
			publicAccess: 'all'
		} ) ;

		await postAlt.save() ;
		
		var post3 = app.root.children.blogs.children.posts.collection.createDocument( {
			title: 'My third post!' ,
			content: 'Yay!' ,
			parent: { collection: 'blogs' , id: blog.getId() } ,
			publicAccess: 'all'
		} ) ;

		await post3.save() ;
		
		var response = await app.get( '/Blogs/' + blog.getId() + '/Posts' , { performer: performer } ) ;
		
		expect( response.output.data ).to.have.length( 3 ) ;
		
		expect( response.output.data ).to.partially.equal( [
			{
				title: 'My first post!' ,
				content: 'Blah blah blah.' ,
				parent: { collection: 'blogs' }
			} ,
			{
				title: 'My second post!' ,
				content: 'Hi ho!' ,
				parent: { collection: 'blogs' }
			} ,
			{
				title: 'My third post!' ,
				content: 'Yay!' ,
				parent: { collection: 'blogs' }
			}
		] ) ;

		// MongoID and expect() do not coop well together, we have to check those properties one by one...
		expect( response.output.data[ 0 ].parent.id.toString() ).to.be( blog.getId().toString() ) ;
		expect( response.output.data[ 1 ].parent.id.toString() ).to.be( blog.getId().toString() ) ;
		expect( response.output.data[ 2 ].parent.id.toString() ).to.be( blog.getId().toString() ) ;
	} ) ;

	it( "POST on nested object should set the parent property correctly" , async () => {
		var { app , performer } = await commonApp() ;
		
		var blog = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;

		await blog.save() ;
		
		var response = await app.post( '/Blogs/' + blog.getId() + '/Posts' ,
			{
				title: 'My first post!!!' ,
				content: 'Blah blah blah...' ,
				parent: 'should not overwrite' ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		var postId = response.output.data.id ;
		
		response = await app.get( '/Blogs/' + blog.getId() + '/Posts/' + postId , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			title: 'My first post!!!' ,
			content: 'Blah blah blah...' ,
			parent: { collection: 'blogs' }
		} ) ;
		expect( response.output.data.parent.id.toString() ).to.be( blog.getId().toString() ) ;
	} ) ;

	it( "PUT on nested object should set the parent property correctly, same for PUT in overwrite mode" , async () => {
		var { app , performer } = await commonApp() ;
		
		var blog = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;
		
		await blog.save() ;
		
		var postId = '5437f8f6c41d00910ec9a5d8' ;
		var response = await app.put( '/Blogs/' + blog.getId() + '/Posts/' + postId ,
			{
				title: 'My first post!!!' ,
				content: 'Blah blah blah...' ,
				parent: 'should not overwrite' ,
				publicAccess: 'all'
			} ,
			null , { performer: performer }
		) ;
		
		response = await app.get( '/Blogs/' + blog.getId() + '/Posts/' + postId , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			title: 'My first post!!!' ,
			content: 'Blah blah blah...' ,
			parent: { collection: 'blogs' }
		} ) ;
		expect( response.output.data.parent.id.toString() ).to.be( blog.getId().toString() ) ;
		
		response = await app.put( '/Blogs/' + blog.getId() + '/Posts/' + postId ,
			{
				title: 'My first post???' ,
				content: 'Blah?' ,
				parent: 'should not overwrite' ,
				publicAccess: 'all'
			} ,
			null , { performer: performer }
		) ;
		
		response = await app.get( '/Blogs/' + blog.getId() + '/Posts/' + postId , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			title: 'My first post???' ,
			content: 'Blah?' ,
			parent: { collection: 'blogs' }
		} ) ;
		expect( response.output.data.parent.id.toString() ).to.be( blog.getId().toString() ) ;
	} ) ;

	it( "PUT on an existed, nested item, with bad ancestry chain" , async () => {
		var { app , performer } = await commonApp() ;

		var blog = app.root.children.blogs.collection.createDocument( {
			title: 'My wonderful life' ,
			description: 'This is a supa blog!' ,
			publicAccess: 'all'
		} ) ;

		await blog.save() ;
		
		var anotherBlog = app.root.children.blogs.collection.createDocument( {
			title: 'Another blog' ,
			description: 'Oh yeah' ,
			publicAccess: 'all'
		} ) ;

		await anotherBlog.save() ;
		
		var post = app.root.children.blogs.children.posts.collection.createDocument( {
			title: 'My second post!' ,
			content: 'Blah blah blah.' ,
			parent: { collection: 'blogs' , id: blog.getId() } ,
			publicAccess: 'all'
		} ) ;

		await post.save() ;
		
		// Ancestry mismatch
		await expect( () => app.put( '/Blogs/' + anotherBlog.getId() + '/Posts/' + post.getId() ,
			{
				title: 'My edited post!' ,
				content: 'Plop.' ,
				publicAccess: 'all'
			} ,
			null , { performer: performer }
		) ).to.reject( ErrorStatus , { type: 'badRequest' , httpStatus: 400 , message: 'Ambigous PUT request: this ID exists but is the child of another parent.' } ) ;

		// Should not be edited
		var response = await app.get( '/Blogs/' + blog.getId() + '/Posts/' + post.getId() , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			title: 'My second post!' ,
			content: 'Blah blah blah.' ,
			parent: { collection: 'blogs' }
		} ) ;
		expect( response.output.data.parent.id.toString() ).to.be( blog.getId().toString() ) ;
	} ) ;
} ) ;



describe( "Links" , () => {

	it( "GET on a link" , async () => {
		var { app , performer } = await commonApp() ;
		
		var response , godfatherId , userId ;
		
		response = await app.post( '/Users' , {
				firstName: "THE" ,
				lastName: "GODFATHER" ,
				email: "godfather@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		godfatherId = response.output.data.id ;
		
		response = await app.post( '/Users' , {
				firstName: "Joe" ,
				lastName: "Doe" ,
				email: "joe.doe@gmail.com" ,
				password: "pw" ,
				publicAccess: "all" ,
				godfather: godfatherId
			} ,
			null ,
			{ performer: performer }
		) ;
		userId = response.output.data.id ;

		response = await app.get( '/Users/' + userId , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			firstName: 'Joe' ,
			lastName: 'Doe' ,
			slugId: 'joe-doe' ,
			email: 'joe.doe@gmail.com' ,
			parent: { id: '/' , collection: null } ,
			godfather: { _id: godfatherId }
		} ) ;
		
		response = await app.get( '/Users/' + userId + '/~godfather' , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			firstName: 'THE' ,
			lastName: 'GODFATHER' ,
			slugId: 'the-godfather' ,
			email: 'godfather@gmail.com' ,
			parent: { id: '/' , collection: null }
		} ) ;
	} ) ;

	it( "GET through a link" ) ;

	it( "PUT (create) on a link" , async () => {
		var { app , performer } = await commonApp() ;

		var response , userId , godfatherId ;

		response = await app.post( '/Users' , {
				firstName: "Joe" ,
				lastName: "Doe" ,
				email: "joe.doe@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId = response.output.data.id ;

		response = await app.put( '/Users/' + userId + '/~godfather' , {
				firstName: "THE" ,
				lastName: "GODFATHER" ,
				email: "godfather@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		godfatherId = response.output.data.id ;
		
		// Get it using a link
		response = await app.get( '/Users/' + userId + '/~godfather' , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			firstName: 'THE' ,
			lastName: 'GODFATHER' ,
			slugId: 'the-godfather' ,
			email: 'godfather@gmail.com' ,
			parent: { id: '/' , collection: null }
		} ) ;

		// Direct get
		response = await app.get( '/Users/' + godfatherId , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			firstName: 'THE' ,
			lastName: 'GODFATHER' ,
			slugId: 'the-godfather' ,
			email: 'godfather@gmail.com' ,
			parent: { id: '/' , collection: null }
		} ) ;
	} ) ;

	it( "PUT (overwrite) on a link" , async () => {
		var { app , performer } = await commonApp() ;

		var response , userId , godfatherId , godfatherId2 ;

		response = await app.post( '/Users' , {
				firstName: "Joe" ,
				lastName: "Doe" ,
				email: "joe.doe@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId = response.output.data.id ;

		response = await app.put( '/Users/' + userId + '/~godfather' , {
				firstName: "THE" ,
				lastName: "GODFATHER" ,
				email: "godfather@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		godfatherId = response.output.data.id ;

		// Check the godfather
		response = await app.get( '/Users/' + userId + '/~godfather' , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			firstName: 'THE' ,
			lastName: 'GODFATHER' ,
			slugId: 'the-godfather' ,
			email: 'godfather@gmail.com' ,
			parent: { id: '/' , collection: null }
		} ) ;
		
		// Overwrite with another godfather
		response = await app.put( '/Users/' + userId + '/~godfather' , {
				firstName: "DAT" ,
				lastName: "GODFATHER!?" ,
				email: "godfather@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		godfatherId2 = response.output.data.id ;

		// Check the godfather2
		response = await app.get( '/Users/' + userId + '/~godfather' , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			firstName: 'DAT' ,
			lastName: 'GODFATHER!?' ,
			slugId: 'the-godfather' ,
			email: 'godfather@gmail.com' ,
			parent: { id: '/' , collection: null }
		} ) ;
		expect( response.output.data._id.toString() ).to.be( godfatherId2.toString() ) ;
		expect( godfatherId.toString() ).to.be( godfatherId2.toString() ) ;
	} ) ;

	it( "PUT through a link" ) ;

	it( "PATCH on a link" , async () => {
		var { app , performer } = await commonApp() ;

		var response , userId , godfatherId ;

		response = await app.post( '/Users' , {
				firstName: "Joe" ,
				lastName: "Doe" ,
				email: "joe.doe@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId = response.output.data.id ;

		response = await app.put( '/Users/' + userId + '/~godfather' , {
				firstName: "THE" ,
				lastName: "GODFATHER" ,
				email: "godfather@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		godfatherId = response.output.data.id ;

		response = await app.patch( '/Users/' + userId + '/~godfather' , { firstName: 'Da' } , null , { performer: performer } ) ;
		
		// Check that the godfather has been modified
		response = await app.get( '/Users/' + userId + '/~godfather' , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			firstName: 'Da' ,
			lastName: 'GODFATHER' ,
			slugId: 'the-godfather' ,
			email: 'godfather@gmail.com' ,
			parent: { id: '/' , collection: null }
		} ) ;
	} ) ;

	it( "PATCH through a link" ) ;

	it( "DELETE on a link" , async () => {
		var { app , performer } = await commonApp() ;
		
		var response , userId , godfatherId ;

		response = await app.post( '/Users' , {
				firstName: "Joe" ,
				lastName: "Doe" ,
				email: "joe.doe@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId = response.output.data.id ;

		response = await app.put( '/Users/' + userId + '/~godfather' , {
				firstName: "THE" ,
				lastName: "GODFATHER" ,
				email: "godfather@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		godfatherId = response.output.data.id ;

		// Just check it exists
		response = await app.get( '/Users/' + userId + '/~godfather' , { performer: performer } ) ;

		// Check that the user has the godfather
		response = await app.get( '/Users/' + userId , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			firstName: "Joe" ,
			lastName: "Doe" ,
			email: "joe.doe@gmail.com" ,
			parent: { id: '/' , collection: null } ,
			godfather: { _id: godfatherId }
		} ) ;
		
		// Delete the godfather now
		response = await app.delete( '/Users/' + userId + '/~godfather' , { performer: performer } ) ;

		await expect( () => app.get( '/Users/' + userId + '/~godfather' , { performer: performer } ) )
			.to.reject( ErrorStatus , { type: 'notFound' , httpStatus: 404 } ) ;

		await expect( () => app.get( '/Users/' + godfatherId , { performer: performer } ) )
			.to.reject( ErrorStatus , { type: 'notFound' , httpStatus: 404 } ) ;

		response = await app.get( '/Users/' + userId , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			firstName: "Joe" ,
			lastName: "Doe" ,
			email: "joe.doe@gmail.com" ,
			parent: { id: '/' , collection: null } ,
			godfather: null
		} ) ;
	} ) ;

	it( "DELETE through a link" ) ;

	it( "POST on a link should fail (it doesn't make sense)" , async () => {
		var { app , performer } = await commonApp() ;

		var response , userId , godfatherId ;

		response = await app.post( '/Users' , {
				firstName: "Joe" ,
				lastName: "Doe" ,
				email: "joe.doe@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId = response.output.data.id ;

		// POST when the link don't exist should be a 'not found'
		await expect( () => app.post( '/Users/' + userId + '/~godfather' , {
				firstName: "THE" ,
				lastName: "GODFATHER" ,
				email: "godfather@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ).to.reject( ErrorStatus , { type: 'notFound' , httpStatus: 404 } ) ;

		response = await app.put( '/Users/' + userId + '/~godfather' , {
				firstName: "THE" ,
				lastName: "GODFATHER" ,
				email: "godfather@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		godfatherId = response.output.data.id ;

		// POST when the link exist should be a 'bad request'
		await expect( () => app.post( '/Users/' + userId + '/~godfather' , {
				firstName: "THE" ,
				lastName: "GODFATHER" ,
				email: "godfather@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ).to.reject( ErrorStatus , { type: 'badRequest' , httpStatus: 400 } ) ;
	} ) ;

	it( "POST through a link" ) ;

	it( "GET + populate links" , async () => {
		var { app , performer } = await commonApp() ;
		
		var response , fatherId , userId , godfatherId ;

		response = await app.post( '/Users' , {
				firstName: "Joe" ,
				lastName: "Doe" ,
				email: "joe.doe@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId = response.output.data.id ;

		response = await app.put( '/Users/' + userId + '/~father' , {
				firstName: "Big Joe" ,
				lastName: "Doe" ,
				email: "big-joe@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		fatherId = response.output.data.id ;

		response = await app.put( '/Users/' + userId + '/~godfather' , {
				firstName: "THE" ,
				lastName: "GODFATHER" ,
				email: "godfather@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		godfatherId = response.output.data.id ;

		response = await app.get( '/Users/' + userId , { performer: performer , query: { populate: [ 'father' , 'godfather' ] } } ) ;
		expect( response.output.data ).to.partially.equal( {
			firstName: "Joe" ,
			lastName: "Doe" ,
			email: "joe.doe@gmail.com" ,
			parent: { id: '/' , collection: null } ,
			father: {
				_id: fatherId ,
				firstName: "Big Joe" ,
				lastName: "Doe" ,
				email: "big-joe@gmail.com"
			} ,
			godfather: {
				_id: godfatherId ,
				firstName: "THE" ,
				lastName: "GODFATHER" ,
				email: "godfather@gmail.com"
			}
		} ) ;
	} ) ;

} ) ;



describe( "Multi-links" , () => {

	it( "GET on and through a multi-link" , async () => {
		var { app , performer } = await commonApp() ;
		
		var response , groupId , userId1 , userId2 , userId3 , userId4 , batch ;

		response = await app.post( '/Users' , {
				firstName: "Joe" ,
				lastName: "Doe" ,
				email: "joe.doe@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId1 = response.output.data.id ;
		
		response = await app.post( '/Users' , {
				firstName: "Jack" ,
				lastName: "Wallace" ,
				email: "jack.wallace@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId2 = response.output.data.id ;
		
		response = await app.post( '/Users' , {
				firstName: "Bobby" ,
				lastName: "Fischer" ,
				email: "bobby.fischer@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId3 = response.output.data.id ;
		
		response = await app.post( '/Users' , {
				firstName: "Not In" ,
				lastName: "Dagroup" ,
				email: "notindagroup@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId4 = response.output.data.id ;
		
		response = await app.post( '/Groups' , {
				name: "The Group" ,
				users: [ userId1 , userId2 , userId3 ] ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		groupId = response.output.data.id ;
		
		response = await app.get( '/Groups/' + groupId + '/~~users' , { performer: performer } ) ;
		batch = response.output.data ;
		expect( batch ).to.have.length( 3 ) ;
		
		var has = {} ;
		has[ batch[ 0 ].firstName ] = true ;
		has[ batch[ 1 ].firstName ] = true ;
		has[ batch[ 2 ].firstName ] = true ;
		expect( has ).to.equal( { Bobby: true , Jack: true , Joe: true } ) ;

		response = await app.get( '/Groups/' + groupId + '/~~users/' + userId1 , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			_id: userId1 ,
			firstName: 'Joe' ,
			lastName: 'Doe' ,
			email: 'joe.doe@gmail.com'
		} ) ;
		
		response = await app.get( '/Groups/' + groupId + '/~~users/' + userId2 , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			_id: userId2 ,
			firstName: 'Jack' ,
			lastName: 'Wallace' ,
			email: 'jack.wallace@gmail.com'
		} ) ;
		
		response = await app.get( '/Groups/' + groupId + '/~~users/' + userId3 , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			_id: userId3 ,
			firstName: 'Bobby' ,
			lastName: 'Fischer' ,
			email: 'bobby.fischer@gmail.com'
		} ) ;
		
		await expect( () => app.get( '/Groups/' + groupId + '/~~users/' + userId4 , { performer: performer } ) )
			.to.reject( ErrorStatus , { type: 'notFound' , httpStatus: 404 } ) ;
	} ) ;

	it( "POST on a multi-link should create a new resource and add it to the current link's array" , async () => {
		var { app , performer } = await commonApp() ;
		
		var response , groupId , userId1 , userId2 , userId3 , userId4 , batch ;

		response = await app.post( '/Users' , {
				firstName: "Joe" ,
				lastName: "Doe" ,
				email: "joe.doe@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId1 = response.output.data.id ;
		
		log.error( "bob" ) ;
		response = await app.post( '/Users' , {
				firstName: "Not In" ,
				lastName: "Dagroup" ,
				email: "notindagroup@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId4 = response.output.data.id ;
		
		log.error( "aabob" ) ;
		response = await app.post( '/Groups' , {
				name: "The Group" ,
				users: [ userId1 , userId2 , userId3 ] ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		groupId = response.output.data.id ;
		
		log.error( "before post on multi link" ) ;
		response = await app.post( '/Groups/' + groupId + '/~~users' , {
				firstName: "Jack" ,
				lastName: "Wallace" ,
				email: "jack.wallace@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId2 = response.output.data.id ;
		
		log.error( "after" ) ;
		response = await app.post( '/Groups/' + groupId + '/~~users' , {
				firstName: "Bobby" ,
				lastName: "Fischer" ,
				email: "bobby.fischer@gmail.com" ,
				password: "pw" ,
				publicAccess: "all"
			} ,
			null ,
			{ performer: performer }
		) ;
		userId3 = response.output.data.id ;

		response = await app.get( '/Groups/' + groupId + '/~~users' , { performer: performer } ) ;
		batch = response.output.data ;

		var has = {} ;
		has[ batch[ 0 ].firstName ] = true ;
		has[ batch[ 1 ].firstName ] = true ;
		has[ batch[ 2 ].firstName ] = true ;
		expect( has ).to.equal( { Bobby: true , Jack: true , Joe: true } ) ;
	} ) ;

	it( "POST through a multi-link" ) ;
	it( "PUT through a multi-link" ) ;

	it( "PATCH through a multi-link" , ( done ) => {

		var app , performer , groupId , userId1 , userId2 , userId3 , userId4 ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Users' , {
					firstName: "Joe" ,
					lastName: "Doe" ,
					email: "joe.doe@gmail.com" ,
					password: "pw" ,
					publicAccess: "all"
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					userId1 = response.id ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Users' , {
					firstName: "Jack" ,
					lastName: "Wallace" ,
					email: "jack.wallace@gmail.com" ,
					password: "pw" ,
					publicAccess: "all"
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					userId2 = response.id ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Groups' , {
					name: "The Group" ,
					users: [ userId1 , userId2 ] ,
					publicAccess: "all"
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					groupId = response.id ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.patch(
					'/Groups/' + groupId + '/~~users/' + userId1 ,
					{ firstName: "Joey" , email: "joey.doe@gmail.com" } ,
					null ,
					{ performer: performer } ,
					( error , document ) => {
						expect( error ).not.to.be.ok() ;
						callback() ;
					}
				) ;
			} ,
			function( callback ) {
				app.get( '/Groups/' + groupId + '/~~users/' + userId1 , { performer: performer } , ( error , document ) => {
					expect( error ).not.to.be.ok() ;
					expect( document._id.toString() ).to.be( userId1.toString() ) ;
					expect( document.firstName ).to.be( 'Joey' ) ;
					expect( document.email ).to.be( 'joey.doe@gmail.com' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "DELETE through a multi-link should remove the targeted link" , ( done ) => {

		var app , performer , groupId , userId1 , userId2 , userId3 , userId4 ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Users' , {
					firstName: "Joe" ,
					lastName: "Doe" ,
					email: "joe.doe@gmail.com" ,
					password: "pw" ,
					publicAccess: "all"
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					userId1 = response.id ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Users' , {
					firstName: "Jack" ,
					lastName: "Wallace" ,
					email: "jack.wallace@gmail.com" ,
					password: "pw" ,
					publicAccess: "all"
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					userId2 = response.id ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Groups' , {
					name: "The Group" ,
					users: [ userId1 , userId2 ] ,
					publicAccess: "all"
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					groupId = response.id ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.delete( '/Groups/' + groupId + '/~~users/' + userId1 , { performer: performer } , ( error , document ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Groups/' + groupId + '/~~users/' + userId1 , { performer: performer } , ( error , document ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'notFound' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Groups/' + groupId + '/~~users' , { performer: performer } , ( error , batch ) => {
					expect( error ).not.to.be.ok() ;
					//console.log( batch ) ;
					expect( batch ).to.have.length( 1 ) ;
					expect( batch[ 0 ]._id.toString()  ).to.be( userId2.toString() ) ;
					expect( batch[ 0 ].firstName  ).to.be( 'Jack' ) ;
					expect( batch[ 0 ].lastName  ).to.be( 'Wallace' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;
} ) ;



describe( "Users" , () => {

	it( "GET on an unexisting user" ) ;

	it( "GET on a regular user" ) ;

	it( "POST then GET" ) ;

	it( "PUT then GET" , async () => {
		var { app , performer } = await commonApp() ;
		
		var response = await app.put( '/Users/5437f846e41d0e910ec9a5d8' , {
				firstName: "Joe" ,
				lastName: "Doe" ,
				email: "joe.doe@gmail.com" ,
				password: "pw"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		response = await app.get( '/Users/5437f846e41d0e910ec9a5d8' , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( { 
			firstName: 'Joe' ,
			lastName: 'Doe' ,
			slugId: 'joe-doe' ,
			email: 'joe.doe@gmail.com' ,
			parent: { id: '/' , collection: null }
		} ) ;

		expect( response.output.data.password ).to.be.an( 'object' ) ;
		expect( response.output.data.password.algo ).to.be( 'sha512' ) ;
		expect( response.output.data.password.salt ).to.be.a( 'string' ) ;
		expect( response.output.data.password.hash ).to.be.a( 'string' ) ;
		// check the password
		expect( hash.password( "pw" , response.output.data.password.salt , response.output.data.password.algo ) ).to.be( response.output.data.password.hash ) ;
	} ) ;

	it( "PUT, then PUT (overwrite), then GET" ) ;

	it( "PATCH on an unexisting user" ) ;

	it( "PUT, then PATCH, then GET" , ( done ) => {

		var app , performer , blog , id ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.put( '/Users/5437f846e41d0e910ec9a5d8' , {
					firstName: "Joe" ,
					lastName: "Doe" ,
					email: "joe.doe@gmail.com" ,
					password: "pw" ,
					publicAccess: 'all'
				} , null , { performer: performer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Users/5437f846e41d0e910ec9a5d8' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.firstName ).to.be( 'Joe' ) ;
					expect( object.lastName ).to.be( 'Doe' ) ;
					expect( object.slugId ).to.be( 'joe-doe' ) ;
					expect( object.email ).to.be( 'joe.doe@gmail.com' ) ;
					//console.log( object.password ) ;
					expect( object.password ).to.be.an( 'object' ) ;
					expect( object.password.algo ).to.be( 'sha512' ) ;
					expect( object.password.salt ).to.be.a( 'string' ) ;
					expect( object.password.hash ).to.be.a( 'string' ) ;
					// check the password
					expect( hash.password( "pw" , object.password.salt , object.password.algo ) ).to.be( object.password.hash ) ;
					expect( object.parent ).to.equal( { id: '/' , collection: null } ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.patch( '/Users/5437f846e41d0e910ec9a5d8' , {
					firstName: "Joey" ,
					lastName: "Doe" ,
					email: "joey.doe@gmail.com" ,
					password: "pw2"
				} , null , { performer: performer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Users/5437f846e41d0e910ec9a5d8' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.firstName ).to.be( 'Joey' ) ;
					expect( object.lastName ).to.be( 'Doe' ) ;
					expect( object.slugId ).to.be( 'joe-doe' ) ;
					expect( object.email ).to.be( 'joey.doe@gmail.com' ) ;
					//console.log( object.password ) ;
					expect( object.password ).to.be.an( 'object' ) ;
					expect( object.password.algo ).to.be( 'sha512' ) ;
					expect( object.password.salt ).to.be.a( 'string' ) ;
					expect( object.password.hash ).to.be.a( 'string' ) ;
					// check the password
					expect( hash.password( "pw2" , object.password.salt , object.password.algo ) ).to.be( object.password.hash ) ;
					expect( object.parent ).to.equal( { id: '/' , collection: null } ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "DELETE on an unexisting user" ) ;

	it( "PUT, then DELETE, then GET" ) ;
} ) ;



describe( "Groups" , () => {

	it( "GET on an unexisting group" ) ;

	it( "GET on a regular group" ) ;

	it( "POST then GET" ) ;

	it( "PUT then GET" ) ;

	it( "PUT, then PUT (overwrite), then GET" ) ;

	it( "PATCH on an unexisting user" ) ;

	it( "PUT, then PATCH, then GET" ) ;

	it( "DELETE on an unexisting user" ) ;

	it( "PUT, then DELETE, then GET" ) ;
} ) ;



describe( "Slug usage" , () => {

	it( "when 'slugGenerationProperty' is set on the schema (to an existing property), it should generate a slug from that property's value" , ( done ) => {

		var app , performer , blog , id ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life!!!' ,
					description: 'This is a supa blog!' ,
					publicAccess: 'all'
				} , null , { performer: performer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'My wonderful life!!!' ) ;
					expect( object.slugId ).to.be( 'my-wonderful-life' ) ;
					expect( object.parent ).to.equal( { id: '/' , collection: null } ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "when a document will generate the same slugId, it should fail with a 409 - Conflict" , ( done ) => {

		var app , performer , blog , id ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Blogs' , {
					title: 'My wonderful life!!!' ,
					description: 'This is a supa blog!' ,
					publicAccess: 'all'
				} , null , { performer: performer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Blogs' , {
					title: 'My wonderful life!!!' ,
					description: 'This is a supa blog 2!' ,
					publicAccess: 'all'
				} , null , { performer: performer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'conflict' ) ;
					expect( error.code ).to.be( 'duplicateKey' ) ;
					expect( error.httpStatus ).to.be( 409 ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "the request URL should support slugId instead of ID (GET, PUT, PATCH, DELETE)" , ( done ) => {

		var app , performer , blog , id ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Blogs' , {
					title: 'My wonderful life!!!' ,
					description: 'This is a supa blog!' ,
					publicAccess: 'all'
				} , null , { performer: performer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/my-wonderful-life' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'My wonderful life!!!' ) ;
					expect( object.slugId ).to.be( 'my-wonderful-life' ) ;
					expect( object.parent ).to.equal( { id: '/' , collection: null } ) ;
					id = object.$.id ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.put( '/Blogs/my-wonderful-life' , {
					title: 'New title!' ,
					description: 'New description!' ,
					publicAccess: 'all'
				} , null , { performer: performer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/' + id , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'New title!' ) ;
					expect( object.slugId ).to.be( 'my-wonderful-life' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// It should not change its slug
				app.get( '/Blogs/my-wonderful-life' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'New title!' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.patch( '/Blogs/my-wonderful-life' , {
					title: 'A brand new title!'
				} , null , { performer: performer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/' + id , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'A brand new title!' ) ;
					expect( object.slugId ).to.be( 'my-wonderful-life' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// It should not change its slug
				app.get( '/Blogs/my-wonderful-life' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'A brand new title!' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.delete( '/Blogs/my-wonderful-life' , { performer: performer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/' + id , { performer: performer } , ( error , object ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'notFound' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// It should not change its slug
				app.get( '/Blogs/my-wonderful-life' , { performer: performer } , ( error , object ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'notFound' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

} ) ;



describe( "Auto collection" , () => {

	it( "Root auto collection" , ( done ) => {

		var app , performer , blog , id ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life!!!' ,
					description: 'This is a supa blog!' ,
					publicAccess: 'all'
				} , null , { performer: performer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'My wonderful life!!!' ) ;
					expect( object.slugId ).to.be( 'my-wonderful-life' ) ;
					expect( object.parent ).to.equal( { id: '/' , collection: null } ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/5437f846c41d0e910ec9a5d8' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'My wonderful life!!!' ) ;
					expect( object.slugId ).to.be( 'my-wonderful-life' ) ;
					expect( object.parent ).to.equal( { id: '/' , collection: null } ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/my-wonderful-life' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'My wonderful life!!!' ) ;
					expect( object.slugId ).to.be( 'my-wonderful-life' ) ;
					expect( object.parent ).to.equal( { id: '/' , collection: null } ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "Collection's auto collection" , ( done ) => {

		var app , performer , blog , id ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life!!!' ,
					description: 'This is a supa blog!' ,
					publicAccess: 'all'
				} , null , { performer: performer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e9f0ec9a5d8' , {
					title: 'You know what?' ,
					content: "I'm happy!" ,
					publicAccess: 'all'
				} , null , { performer: performer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e9f0ec9a5d8' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'You know what?' ) ;
					expect( object.slugId ).to.be( 'you-know-what' ) ;
					expect( object.parent.id.toString() ).to.be( '5437f846c41d0e910ec9a5d8' ) ;
					expect( object.parent.collection ).to.be( 'blogs' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8/5437f846c41d0e9f0ec9a5d8' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'You know what?' ) ;
					expect( object.slugId ).to.be( 'you-know-what' ) ;
					expect( object.parent.id.toString() ).to.be( '5437f846c41d0e910ec9a5d8' ) ;
					expect( object.parent.collection ).to.be( 'blogs' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e9f0ec9a5d8' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'You know what?' ) ;
					expect( object.slugId ).to.be( 'you-know-what' ) ;
					expect( object.parent.id.toString() ).to.be( '5437f846c41d0e910ec9a5d8' ) ;
					expect( object.parent.collection ).to.be( 'blogs' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/5437f846c41d0e910ec9a5d8/5437f846c41d0e9f0ec9a5d8' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'You know what?' ) ;
					expect( object.slugId ).to.be( 'you-know-what' ) ;
					expect( object.parent.id.toString() ).to.be( '5437f846c41d0e910ec9a5d8' ) ;
					expect( object.parent.collection ).to.be( 'blogs' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/my-wonderful-life/you-know-what' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'You know what?' ) ;
					expect( object.slugId ).to.be( 'you-know-what' ) ;
					expect( object.parent.id.toString() ).to.be( '5437f846c41d0e910ec9a5d8' ) ;
					expect( object.parent.collection ).to.be( 'blogs' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/my-wonderful-life/Posts/you-know-what' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'You know what?' ) ;
					expect( object.slugId ).to.be( 'you-know-what' ) ;
					expect( object.parent.id.toString() ).to.be( '5437f846c41d0e910ec9a5d8' ) ;
					expect( object.parent.collection ).to.be( 'blogs' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/my-wonderful-life/you-know-what' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'You know what?' ) ;
					expect( object.slugId ).to.be( 'you-know-what' ) ;
					expect( object.parent.id.toString() ).to.be( '5437f846c41d0e910ec9a5d8' ) ;
					expect( object.parent.collection ).to.be( 'blogs' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;
} ) ;



describe( "Token creation" , () => {

	it( "login, a.k.a. token creation using POST /Users/CREATE-TOKEN" , async () => {
		var { app , performer } = await commonApp() ;

		var response = await app.post( '/Users' , {
				firstName: "Bobby" ,
				lastName: "Fisher" ,
				email: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		var id = response.output.data.id ;
		expect( id ).to.be.an( 'objectId' ) ;
		
		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		expect( response.output.data ).to.equal( {
			userId: id ,
			token: response.output.data.token ,	// unpredictable
			type: "header" ,
			agentId: "0123456789" ,
			creationTime: response.output.data.creationTime ,	// not predictable at all
			expirationTime: response.output.data.expirationTime ,	// not predictable at all
			duration: 900000
		} ) ;
		expect( response.output.data.token.length ).to.be( 44 ) ;
		
		var tokenData = app.collectionNodes.users.extractFromToken( response.output.data.token ) ;

		expect( tokenData ).to.equal( {
			type: "header" ,
			userId: id.toString() ,
			agentId: "0123456789" ,
			expirationTime: response.output.data.expirationTime ,
			//increment: tokenData.increment ,	// unpredictable
			securityCode: tokenData.securityCode	// unpredictable
		} ) ;

		var token = response.output.data.token ;

		// Should found the token in the user document
		response = await app.get( '/Users/' + id , { performer: performer } ) ;
		expect( response.output.data.token[ token ] ).to.be.ok() ;
	} ) ;

	it( "token creation using a bad login should fail" , async () => {
		var { app , performer } = await commonApp() ;

		var response = await app.post( '/Users' , {
				firstName: "Bobby" ,
				lastName: "Fisher" ,
				email: "bobby.fisher@gmail.com" ,
				password: "pw"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		await expect( () => app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "wrong@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ).to.reject( ErrorStatus , { type: 'unauthorized' , httpStatus: 401 } ) ;
	} ) ;

	it( "token creation using a bad password should fail" , async () => {
		var { app , performer } = await commonApp() ;

		var response = await app.post( '/Users' , {
				firstName: "Bobby" ,
				lastName: "Fisher" ,
				email: "bobby.fisher@gmail.com" ,
				password: "pw"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		await expect( () => app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "bad pw" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ).to.reject( ErrorStatus , { type: 'unauthorized' , httpStatus: 401 } ) ;
	} ) ;

	it( "using domain-restricted users: POST /Blogs/id/Users/CREATE-TOKEN" , async () => {
		var { app , performer } = await commonApp() ;

		var response = await app.post( '/Blogs' , {
				title: 'My wonderful life' ,
				description: 'This is a supa blog!' ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		var blogId = response.output.data.id ;
		
		response = await app.post( '/Blogs/' + blogId + '/Users' , {
				firstName: "Bobby" ,
				lastName: "Fisher" ,
				email: "bobby.fisher@gmail.com" ,
				password: "pw"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		var id = response.output.data.id ;
		
		response = await app.post( '/Blogs/' + blogId + '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		expect( response.output.data.userId.toString() ).to.be( id.toString() ) ;
		expect( response.output.data.token.length ).to.be( 44 ) ;

		// Should not works globally!
		await expect( () => app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ).to.reject( ErrorStatus , { type: 'unauthorized' , httpStatus: 401 } ) ;
	} ) ;

	it( "POST /Users/CREATE-TOKEN action should cleanup outdated tokens" , async () => {
		var { app , performer } = await commonApp() ;
		
		var response , id , duration , token , tokenData , newTokenData ;

		// Create the user
		response = await app.post( '/Users' , {
				firstName: "Bobby" ,
				lastName: "Fisher" ,
				email: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		id = response.output.data.id ;
		expect( id ).to.be.an( 'objectId' ) ;
		
		duration = 300 ;

		// Create the token to test garbage collection on
		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789" ,
				duration: duration
			} ,
			null ,
			{ performer: performer }
		) ;
		
		expect( response.output.data ).to.equal( {
			userId: id ,
			token: response.output.data.token ,	// unpredictable
			type: "header" ,
			agentId: "0123456789" ,
			creationTime: response.output.data.creationTime ,	// not predictable at all
			expirationTime: response.output.data.expirationTime ,	// not predictable at all
			duration: duration
		} ) ;
		expect( response.output.data.token.length ).to.be( 44 ) ;

		tokenData = app.collectionNodes.users.extractFromToken( response.output.data.token ) ;

		expect( tokenData ).to.equal( {
			type: "header" ,
			userId: id.toString() ,
			agentId: "0123456789" ,
			expirationTime: response.output.data.expirationTime ,
			//increment: tokenData.increment ,	// unpredictable
			securityCode: tokenData.securityCode	// unpredictable
		} ) ;

		token = response.output.data.token ;

		// Should found the token in the user document
		response = await app.get( '/Users/' + id , { performer: performer } ) ;
		expect( response.output.data.token[ token ] ).to.be.ok() ;

		duration = 100000 ;

		// Create a new token: the first should still be there after that
		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789" ,
				duration: duration
			} ,
			null ,
			{ performer: performer }
		) ;
		
		expect( response.output.data ).to.equal( {
			userId: id ,
			token: response.output.data.token ,	// unpredictable
			type: "header" ,
			agentId: "0123456789" ,
			creationTime: response.output.data.creationTime ,	// not predictable at all
			expirationTime: response.output.data.expirationTime ,	// not predictable at all
			duration: duration
		} ) ;
		expect( response.output.data.token.length ).to.be( 44 ) ;

		newTokenData = app.collectionNodes.users.extractFromToken( response.output.data.token ) ;

		expect( newTokenData ).to.equal( {
			type: "header" ,
			userId: id.toString() ,
			agentId: "0123456789" ,
			expirationTime: response.output.data.expirationTime ,
			//increment: tokenData.increment ,	// unpredictable
			securityCode: newTokenData.securityCode	// unpredictable
		} ) ;

		// First token should still be there
		response = await app.get( '/Users/' + id , { performer: performer } ) ;
		expect( response.output.data.token[ token ] ).to.be.ok() ;

		// Wait so the first token will not be here anymore
		await Promise.resolveTimeout( 310 ) ;

		duration = 100000 ;

		// Create again a new token: the first should be garbage collected now
		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789" ,
				duration: duration
			} ,
			null ,
			{ performer: performer }
		) ;
		
		expect( response.output.data ).to.equal( {
			userId: id ,
			token: response.output.data.token ,	// unpredictable
			type: "header" ,
			agentId: "0123456789" ,
			creationTime: response.output.data.creationTime ,	// not predictable at all
			expirationTime: response.output.data.expirationTime ,	// not predictable at all
			duration: duration
		} ) ;
		expect( response.output.data.token.length ).to.be( 44 ) ;

		// The first token should have been garbage collected
		response = await app.get( '/Users/' + id , { performer: performer } ) ;
		//log.error( "%Y" , response.output.data ) ;
		expect( response.output.data.token[ token ] ).not.to.be.ok() ;
	} ) ;

	it( "POST /Users/REGENERATE-TOKEN should generate a new token using an existing one that will have its TTL shortened" , async () => {
		var { app , performer } = await commonApp() ;

		var response , oldTokenPerformer , id , oldToken , newToken , oldTokenOldExpirationTime , oldTokenNewExpirationTime ;

		// Create the user
		response = await app.post( '/Users' , {
				firstName: "Bobby" ,
				lastName: "Fisher" ,
				email: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		id = response.output.data.id ;
		expect( id ).to.be.an( 'objectId' ) ;

		// Create the token
		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ;

		expect( response.output.data ).to.equal( {
			userId: id ,
			token: response.output.data.token ,	// unpredictable
			type: "header" ,
			agentId: "0123456789" ,
			creationTime: response.output.data.creationTime ,	// not predictable at all
			expirationTime: response.output.data.expirationTime ,	// not predictable at all
			duration: 900000
		} ) ;
		expect( response.output.data.token.length ).to.be( 44 ) ;
		
		var tokenData = app.collectionNodes.users.extractFromToken( response.output.data.token ) ;

		expect( tokenData ).to.equal( {
			type: "header" ,
			userId: id.toString() ,
			agentId: "0123456789" ,
			expirationTime: response.output.data.expirationTime ,
			//increment: tokenData.increment ,	// unpredictable
			securityCode: tokenData.securityCode	// unpredictable
		} ) ;

		oldTokenOldExpirationTime = response.output.data.expirationTime ;
		oldToken = response.output.data.token ;

		oldTokenPerformer = app.createPerformer( {
			type: "header" ,
			userId: response.output.data.userId ,
			token: response.output.data.token ,
			agentId: "0123456789"
		} ) ;

		// Should found the token in the user document
		response = await app.get( '/Users/' + id , { performer: performer } ) ;
		expect( response.output.data.token[ oldToken ] ).to.be.ok() ;
		
		// Regenerate token
		response = await app.post( '/Users/REGENERATE-TOKEN' , {} , null , { performer: oldTokenPerformer } ) ;
		
		expect( response.output.data ).to.equal( {
			userId: id ,
			token: response.output.data.token ,	// unpredictable
			type: "header" ,
			agentId: "0123456789" ,
			creationTime: response.output.data.creationTime ,	// not predictable at all
			expirationTime: response.output.data.expirationTime ,	// not predictable at all
			duration: 900000
		} ) ;
		expect( response.output.data.token.length ).to.be( 44 ) ;

		oldTokenNewExpirationTime = response.output.data.creationTime + 10000 ;
		var tokenData = app.collectionNodes.users.extractFromToken( response.output.data.token ) ;

		expect( tokenData ).to.equal( {
			type: "header" ,
			userId: id.toString() ,
			agentId: "0123456789" ,
			expirationTime: response.output.data.expirationTime ,
			//increment: tokenData.increment ,	// unpredictable
			securityCode: tokenData.securityCode	// unpredictable
		} ) ;

		newToken = response.output.data.token ;

		// Check the old token
		response = await app.get( '/Users/' + id , { performer: performer } ) ;
		expect( response.output.data.token[ oldToken ] ).to.be.ok() ;
		expect( response.output.data.token[ oldToken ].expirationTime ).not.to.be( oldTokenOldExpirationTime ) ;
		expect( response.output.data.token[ oldToken ].expirationTime ).to.be.within( oldTokenNewExpirationTime - 200 , oldTokenNewExpirationTime + 200 ) ;
		expect( response.output.data.token[ newToken ] ).to.be.ok() ;
	} ) ;

	it( "POST /Users/REVOKE-TOKEN should revoke the current token, i.e. remove it from the user document" , async () => {
		var { app , performer } = await commonApp() ;

		var response , tokenPerformer , tokenPerformerArg , id , token ;

		// Create the user
		response = await app.post( '/Users' , {
				firstName: "Bobby" ,
				lastName: "Fisher" ,
				email: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		id = response.output.data.id ;
		expect( id ).to.be.an( 'objectId' ) ;

		// Create the token
		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ;

		expect( response.output.data ).to.equal( {
			userId: id ,
			token: response.output.data.token ,	// unpredictable
			type: "header" ,
			agentId: "0123456789" ,
			creationTime: response.output.data.creationTime ,	// not predictable at all
			expirationTime: response.output.data.expirationTime ,	// not predictable at all
			duration: 900000
		} ) ;
		expect( response.output.data.token.length ).to.be( 44 ) ;
		
		var tokenData = app.collectionNodes.users.extractFromToken( response.output.data.token ) ;

		expect( tokenData ).to.equal( {
			type: "header" ,
			userId: id.toString() ,
			agentId: "0123456789" ,
			expirationTime: response.output.data.expirationTime ,
			//increment: tokenData.increment ,	// unpredictable
			securityCode: tokenData.securityCode	// unpredictable
		} ) ;
		
		token = response.output.data.token ;

		tokenPerformerArg = {
			type: "header" ,
			userId: response.output.data.userId ,
			token: response.output.data.token ,
			agentId: "0123456789"
		} ;

		tokenPerformer = app.createPerformer( tokenPerformerArg ) ;

		// Should found the token in the user document
		response = await app.get( '/Users/' + id , { performer: performer } ) ;
		expect( response.output.data.token[ token ] ).to.be.ok() ;


		// Revoke the token now
		response = await app.post( '/Users/REVOKE-TOKEN' , {} , null , { performer: tokenPerformer } ) ;
		
		// Should not found the token anymore
		response = await app.get( '/Users/' + id , { performer: performer } ) ;
		expect( response.output.data.token[ token ] ).not.to.be.ok() ;
		
		// We recreate a new performer, or the test will fail: it will use a cached user.
		// It's worth noting here that a new performer IS ACTUALLY CREATED for each request in real apps.
		tokenPerformer = app.createPerformer( tokenPerformerArg ) ;

		await expect( () => app.post( '/Users/REVOKE-TOKEN' , {} , null , { performer: tokenPerformer } ) )
			.to.reject( ErrorStatus , { type: 'unauthorized' , httpStatus: 401 , message: 'Token not found.' } ) ;
	} ) ;

	it( "POST /Users/REVOKE-ALL-TOKENS should revoke all tokens, i.e. remove them from the user document" , async () => {
		var { app , performer } = await commonApp() ;
		
		var response , id , tokenPerformer , tokenPerformerArg , token , tokenPerformer2 , token2 ;


		// Create the user
		response = await app.post( '/Users' , {
				firstName: "Bobby" ,
				lastName: "Fisher" ,
				email: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		id = response.output.data.id ;
		expect( id ).to.be.an( 'objectId' ) ;

		// Create the token #1
		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ;

		token = response.output.data.token ;

		tokenPerformerArg = {
			type: "header" ,
			userId: response.output.data.userId ,
			token: response.output.data.token ,
			agentId: "0123456789"
		} ;

		tokenPerformer = app.createPerformer( tokenPerformerArg ) ;

		// Create the token #2
		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ;

		token2 = response.output.data.token ;

		tokenPerformerArg = {
			type: "header" ,
			userId: response.output.data.userId ,
			token: response.output.data.token ,
			agentId: "0123456789"
		} ;

		tokenPerformer2 = app.createPerformer( tokenPerformerArg ) ;

		// Should found both tokens in the user document
		response = await app.get( '/Users/' + id , { performer: performer } ) ;
		expect( response.output.data.token[ token ] ).to.be.ok() ;
		expect( response.output.data.token[ token2 ] ).to.be.ok() ;


		// Revoke ALL tokens now
		response = await app.post( '/Users/REVOKE-ALL-TOKENS' , {} , null , { performer: tokenPerformer } ) ;

		// Should not found either token in the user document
		response = await app.get( '/Users/' + id , { performer: performer } ) ;
		expect( response.output.data.token[ token ] ).not.to.be.ok() ;
		expect( response.output.data.token[ token2 ] ).not.to.be.ok() ;

		// We recreate a new performer, or the test will fail: it will use a cached user.
		// It's worth noting here that a new performer IS ACTUALLY CREATED for each request in real apps.
		tokenPerformer = app.createPerformer( tokenPerformerArg ) ;

		await expect( () => app.post( '/Users/REVOKE-TOKEN' , {} , null , { performer: tokenPerformer } ) )
			.to.reject( ErrorStatus , { type: 'unauthorized' , httpStatus: 401 , message: 'Token not found.' } ) ;

		await expect( () => app.post( '/Users/REVOKE-TOKEN' , {} , null , { performer: tokenPerformer2 } ) )
			.to.reject( ErrorStatus , { type: 'unauthorized' , httpStatus: 401 , message: 'Token not found.' } ) ;
	} ) ;

	it( "'Too many tokens'" ) ;
} ) ;



describe( "Access" , () => {

	var app , performer ,
		notConnectedPerformer ,
		authorizedId , authorizedPerformer ,
		authorizedByGroupId , authorizedByGroupPerformer ,
		notEnoughAuthorizedId , notEnoughAuthorizedPerformer ,
		unauthorizedId , unauthorizedPerformer ,
		authorizedGroupId , unauthorizedGroupId ;

	// Create the users for the test

	beforeEach( async () => {
		( { app , performer } = await commonApp() ) ;
		notConnectedPerformer = app.createPerformer() ;
		
		var response = await app.post( '/Users' , {
				firstName: "Bobby" ,
				lastName: "Fisher" ,
				email: "bobby.fisher@gmail.com" ,
				password: "pw"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		authorizedId = response.output.data.id ;
		
		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "bobby.fisher@gmail.com" ,
				password: "pw" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		expect( response.output.data.userId.toString() ).to.be( authorizedId.toString() ) ;
		
		authorizedPerformer = app.createPerformer( {
			type: "header" ,
			userId: response.output.data.userId ,
			token: response.output.data.token ,
			agentId: "0123456789"
		} ) ;
		
		response = await app.post( '/Users' , {
				firstName: "Groupy" ,
				lastName: "Groups" ,
				email: "groupy@gmail.com" ,
				password: "groupy"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		authorizedByGroupId = response.output.data.id ;

		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "groupy@gmail.com" ,
				password: "groupy" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		expect( response.output.data.userId.toString() ).to.be( authorizedByGroupId.toString() ) ;

		authorizedByGroupPerformer = app.createPerformer( {
			type: "header" ,
			userId: response.output.data.userId ,
			token: response.output.data.token ,
			agentId: "0123456789"
		} ) ;

		response = await app.post( '/Users' , {
				firstName: "not" ,
				lastName: "enough" ,
				email: "not-enough@gmail.com" ,
				password: "notenough"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		notEnoughAuthorizedId = response.output.data.id ;
		
		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "not-enough@gmail.com" ,
				password: "notenough" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		expect( response.output.data.userId.toString() ).to.be( notEnoughAuthorizedId.toString() ) ;

		notEnoughAuthorizedPerformer = app.createPerformer( {
			type: "header" ,
			userId: response.output.data.userId ,
			token: response.output.data.token ,
			agentId: "0123456789"
		} ) ;

		response = await app.post( '/Users' , {
				firstName: "Peon" ,
				lastName: "Peon" ,
				email: "peon@gmail.com" ,
				password: "peon"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		unauthorizedId = response.output.data.id ;
		
		response = await app.post( '/Users/CREATE-TOKEN' , {
				type: "header" ,
				login: "peon@gmail.com" ,
				password: "peon" ,
				agentId: "0123456789"
			} ,
			null ,
			{ performer: performer }
		) ;
		
		expect( response.output.data.userId.toString() ).to.be( unauthorizedId.toString() ) ;
		
		unauthorizedPerformer = app.createPerformer( {
			type: "header" ,
			userId: response.output.data.userId ,
			token: response.output.data.token ,
			agentId: "0123456789"
		} ) ;

		response = await app.post( '/Groups' , {
				name: "unauthorized group" ,
				users: [ notEnoughAuthorizedId , authorizedByGroupId ]
			} ,
			null ,
			{ performer: performer }
		) ;
		
		unauthorizedGroupId = response.output.data.id ;

		response = await app.post( '/Groups' , {
				name: "authorized group" ,
				users: [ authorizedByGroupId ]
			} ,
			null ,
			{ performer: performer }
		) ;
		
		authorizedGroupId = response.output.data.id ;
	} ) ;

	it( "GET a restricted resource performed by various connected and non-connected users" , ( done ) => {

		async.series( [
			function( callback ) {
				var userAccess = {} ;
				userAccess[ authorizedId ] = 'read' ;	// Minimal right that pass
				userAccess[ notEnoughAuthorizedId ] = 'passThrough' ;	// Maximal right that does not pass

				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life 2!!!' ,
					description: 'This is a supa blog! (x2)' ,
					userAccess: userAccess ,
					publicAccess: 'none'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: authorizedPerformer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'My wonderful life 2!!!' ) ;
					expect( object.description ).to.be( 'This is a supa blog! (x2)' ) ;
					expect( object.parent ).to.equal( { id: '/' , collection: null } ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// Non-connected user
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: notConnectedPerformer } , ( error , object ) => {

					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'unauthorized' ) ;
					expect( error.message ).to.be( 'Public access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User not listed in specific rights
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: unauthorizedPerformer } , ( error , object ) => {

					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User listed, but with too low rights
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: notEnoughAuthorizedPerformer } , ( error , object ) => {

					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "GET a restricted resource performed by a token that has already expired should fail" , ( done ) => {

		var expiredTokenPerformer ;

		async.series( [
			function( callback ) {
				app.post( '/Users/CREATE-TOKEN' , {
					type: "header" ,
					login: "bobby.fisher@gmail.com" ,
					password: "pw" ,
					agentId: "0123456789" ,
					duration: 0
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					expect( response.userId.toString() ).to.be( authorizedId.toString() ) ;
					expect( response.token.length ).to.be( 44 ) ;

					expiredTokenPerformer = app.createPerformer( {
						type: "header" ,
						userId: response.userId ,
						token: response.token ,
						agentId: "0123456789"
					} ) ;

					callback() ;
				} ) ;
			} ,
			function( callback ) {
				var userAccess = {} ;
				userAccess[ authorizedId ] = 'read' ;	// Minimal right that pass

				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life 2!!!' ,
					description: 'This is a supa blog! (x2)' ,
					userAccess: userAccess ,
					publicAccess: 'none'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: authorizedPerformer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'My wonderful life 2!!!' ) ;
					expect( object.description ).to.be( 'This is a supa blog! (x2)' ) ;
					expect( object.parent ).to.equal( { id: '/' , collection: null } ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// Expired token
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: expiredTokenPerformer } , ( error , object ) => {

					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'unauthorized' ) ;
					expect( error.message ).to.be( 'This token has already expired.' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "GET a collection having restricted resources, performed by various connected and non-connected users" , ( done ) => {

		async.series( [
			function( callback ) {
				app.post( '/Blogs' , {
					title: 'Public' ,
					description: 'This is public' ,
					publicAccess: 'read'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				var userAccess = {} ;
				userAccess[ authorizedId ] = 'read' ;
				userAccess[ notEnoughAuthorizedId ] = 'read' ;

				app.post( '/Blogs' , {
					title: 'Selective' ,
					description: 'This is selective' ,
					userAccess: userAccess ,
					publicAccess: 'none'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				var userAccess = {} ;
				userAccess[ authorizedId ] = 'read' ;
				userAccess[ notEnoughAuthorizedId ] = 'passThrough' ;

				app.post( '/Blogs' , {
					title: 'Closed' ,
					description: 'This is closed' ,
					userAccess: userAccess ,
					publicAccess: 'none'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/' , { performer: authorizedPerformer } , ( error , batch ) => {

					expect( error ).not.to.be.ok() ;
					//console.log( batch ) ;
					expect( batch.length ).to.be( 3 ) ;

					var titles = [ batch[ 0 ].title , batch[ 1 ].title , batch[ 2 ].title ] ;

					expect( titles ).to.contain( 'Public' ) ;
					expect( titles ).to.contain( 'Selective' ) ;
					expect( titles ).to.contain( 'Closed' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// Non-connected user
				app.get( '/Blogs/' , { performer: notConnectedPerformer } , ( error , batch ) => {

					expect( error ).not.to.be.ok() ;
					expect( batch.length ).to.be( 1 ) ;
					expect( batch[ 0 ].title ).to.be( 'Public' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User not listed in specific rights
				app.get( '/Blogs/' , { performer: unauthorizedPerformer } , ( error , batch ) => {

					expect( batch.length ).to.be( 1 ) ;
					expect( batch[ 0 ].title ).to.be( 'Public' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User listed, but with too low rights
				app.get( '/Blogs/' , { performer: notEnoughAuthorizedPerformer } , ( error , batch ) => {

					expect( batch.length ).to.be( 2 ) ;
					expect( batch[ 0 ].title ).to.be( 'Public' ) ;
					expect( batch[ 1 ].title ).to.be( 'Selective' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "PUT (overwrite) a restricted resource performed by various connected and non-connected users" , ( done ) => {

		async.series( [
			function( callback ) {
				var userAccess = {} ;
				userAccess[ authorizedId ] = 'readCreateModifyReplace' ;	// Minimal right that pass
				userAccess[ notEnoughAuthorizedId ] = 'readCreate' ;	// Maximal right that does not pass

				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life 2!!!' ,
					description: 'This is a supa blog! (x2)' ,
					userAccess: userAccess ,
					publicAccess: 'none'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				var userAccess = {} ;
				userAccess[ authorizedId ] = 'readCreateModifyReplace' ;	// Minimal right that pass
				userAccess[ notEnoughAuthorizedId ] = 'read' ;	// Maximal right that does not pass

				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: "I've changed my mind!" ,
					description: 'Seriously!' ,
					userAccess: userAccess ,
					publicAccess: 'none'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// Non-connected user
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: "I cant do that!" ,
					description: 'Seriously!'
				} , null , { performer: notConnectedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'unauthorized' ) ;
					expect( error.message ).to.be( 'Public access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User not listed in specific rights
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: "I cant do that!" ,
					description: 'Seriously!'
				} , null , { performer: unauthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User listed, but with too low rights
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: "I cant do that!" ,
					description: 'Seriously!'
				} , null , { performer: notEnoughAuthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "PATCH a restricted resource performed by various connected and non-connected users" , ( done ) => {

		async.series( [
			function( callback ) {
				var userAccess = {} ;
				userAccess[ authorizedId ] = 'readCreateModify' ;	// Minimal right that pass
				userAccess[ notEnoughAuthorizedId ] = 'readCreate' ;	// Maximal right that does not pass

				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life 2!!!' ,
					description: 'This is a supa blog! (x2)' ,
					userAccess: userAccess ,
					publicAccess: 'none'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.patch( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: "I've changed my mind!"
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// Non-connected user
				app.patch( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: "I cant do that!"
				} , null , { performer: notConnectedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'unauthorized' ) ;
					expect( error.message ).to.be( 'Public access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User not listed in specific rights
				app.patch( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: "I cant do that!"
				} , null , { performer: unauthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User listed, but with too low rights
				app.patch( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: "I cant do that!"
				} , null , { performer: notEnoughAuthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "DELETE a restricted resource performed by various connected and non-connected users" , ( done ) => {

		async.series( [
			function( callback ) {
				var userAccess = {} ;
				userAccess[ authorizedId ] = 'all' ;	// Minimal right that pass
				userAccess[ notEnoughAuthorizedId ] = 'readCreateModify' ;	// Maximal right that does not pass

				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life 2!!!' ,
					description: 'This is a supa blog! (x2)' ,
					userAccess: userAccess ,
					publicAccess: 'none'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// Non-connected user
				app.delete( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: notConnectedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'unauthorized' ) ;
					expect( error.message ).to.be( 'Public access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User not listed in specific rights
				app.delete( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: unauthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User listed, but with too low rights
				app.delete( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: notEnoughAuthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.delete( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "PUT (create) into a restricted resource performed by various connected and non-connected users" , ( done ) => {

		async.series( [
			function( callback ) {
				var userAccess = {} ;
				userAccess[ authorizedId ] = 'readCreate' ;	// Minimal right that pass
				userAccess[ notEnoughAuthorizedId ] = 'read' ;	// Maximal right that does not pass

				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life 2!!!' ,
					description: 'This is a supa blog! (x2)' ,
					userAccess: userAccess ,
					publicAccess: 'none'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d0' , {
					title: 'Put one' ,
					content: 'Blah blah blah...' ,
					publicAccess: 'read'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// Non-connected user
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d1' , {
					title: 'Put two' ,
					content: 'Blah blah blah...' ,
					publicAccess: 'read'
				} , null , { performer: notConnectedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'unauthorized' ) ;
					expect( error.message ).to.be( 'Public access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User not listed in specific rights
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d2' , {
					title: 'Put three' ,
					content: 'Blah blah blah...' ,
					publicAccess: 'read'
				} , null , { performer: unauthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User listed, but with too low rights
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d3' , {
					title: 'Put four' ,
					content: 'Blah blah blah...' ,
					publicAccess: 'read'
				} , null , { performer: notEnoughAuthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "POST into a restricted resource performed by various connected and non-connected users" , ( done ) => {

		async.series( [
			function( callback ) {
				var userAccess = {} ;
				userAccess[ authorizedId ] = 'readCreate' ;	// Minimal right that pass
				userAccess[ notEnoughAuthorizedId ] = 'read' ;	// Maximal right that does not pass

				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life 2!!!' ,
					description: 'This is a supa blog! (x2)' ,
					userAccess: userAccess ,
					publicAccess: 'none'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Blogs/5437f846c41d0e910ec9a5d8/Posts' , {
					title: 'Post one' ,
					content: 'Blah blah blah...' ,
					publicAccess: 'read'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// Non-connected user
				app.post( '/Blogs/5437f846c41d0e910ec9a5d8/Posts' , {
					title: 'Post two' ,
					content: 'Blah blah blah...' ,
					publicAccess: 'read'
				} , null , { performer: notConnectedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'unauthorized' ) ;
					expect( error.message ).to.be( 'Public access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User not listed in specific rights
				app.post( '/Blogs/5437f846c41d0e910ec9a5d8/Posts' , {
					title: 'Post three' ,
					content: 'Blah blah blah...' ,
					publicAccess: 'read'
				} , null , { performer: unauthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User listed, but with too low rights
				app.post( '/Blogs/5437f846c41d0e910ec9a5d8/Posts' , {
					title: 'Post four' ,
					content: 'Blah blah blah...' ,
					publicAccess: 'read'
				} , null , { performer: notEnoughAuthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "Access by groups" , ( done ) => {

		async.series( [
			function( callback ) {
				var userAccess = {} ;
				userAccess[ authorizedId ] = 'read' ;
				//userAccess[ authorizedByGroupId ] = 'passThrough' ;

				var groupAccess = {} ;
				groupAccess[ authorizedGroupId ] = 'read' ;

				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life 2!!!' ,
					description: 'This is a supa blog! (x2)' ,
					userAccess: userAccess ,
					groupAccess: groupAccess ,
					publicAccess: 'none'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: authorizedPerformer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'My wonderful life 2!!!' ) ;
					expect( object.description ).to.be( 'This is a supa blog! (x2)' ) ;
					expect( object.parent ).to.equal( { id: '/' , collection: null } ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User authorized by its group
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: authorizedByGroupPerformer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object.title ).to.be( 'My wonderful life 2!!!' ) ;
					expect( object.description ).to.be( 'This is a supa blog! (x2)' ) ;
					expect( object.parent ).to.equal( { id: '/' , collection: null } ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User listed, but with too low rights
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: notEnoughAuthorizedPerformer } , ( error , object ) => {

					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// Non-connected user
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: notConnectedPerformer } , ( error , object ) => {

					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'unauthorized' ) ;
					expect( error.message ).to.be( 'Public access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User not listed in specific rights
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: unauthorizedPerformer } , ( error , object ) => {

					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "PATCH of nested resource with inheritance" , ( done ) => {

		async.series( [
			function( callback ) {
				var userAccess = {} ;

				userAccess[ authorizedId ] = {
					read: 4 ,
					write: 4 ,
					create: 1 ,
					inheritance: {
						read: 4 ,
						write: 4
					}
				} ;

				userAccess[ notEnoughAuthorizedId ] = 'readCreateModify' ;	// Maximal right that does not pass

				app.put( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					title: 'My wonderful life 2!!!' ,
					description: 'This is a supa blog! (x2)' ,
					userAccess: userAccess ,
					publicAccess: 'passThrough'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.put( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d0' , {
					title: 'A boring title' ,
					content: 'Blah blah blah...'
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.patch( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d0' , {
					title: "I've changed my mind!"
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User not listed in specific rights
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d0' ,
					{ performer: authorizedPerformer } ,
					( error , document ) => {
						expect( error ).not.to.be.ok() ;
						expect( document.title ).to.be( "I've changed my mind!" ) ;
						callback() ;
					}
				) ;
			} ,
			function( callback ) {
				// Non-connected user
				app.patch( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d0' , {
					title: "I can't do that!"
				} , null , { performer: notConnectedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'unauthorized' ) ;
					expect( error.message ).to.be( 'Public access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User not listed in specific rights
				app.patch( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d0' , {
					title: "I can't do that!"
				} , null , { performer: unauthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User listed, but with too low rights
				app.patch( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d0' , {
					title: "I can't do that!"
				} , null , { performer: notEnoughAuthorizedPerformer } , ( error ) => {
					expect( error ).to.be.ok() ;
					expect( error.type ).to.be( 'forbidden' ) ;
					expect( error.message ).to.be( 'Access forbidden.' ) ;
					callback() ;
				} ) ;
			} ,

			// Now give public access

			function( callback ) {
				app.patch( '/Blogs/5437f846c41d0e910ec9a5d8' , {
					publicAccess: {
						traverse: 1 ,
						inheritance: {
							read: 4 ,
							write: 4
						}
					}
				} , null , { performer: authorizedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// Non-connected user
				app.patch( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d0' , {
					title: "I can do that!"
				} , null , { performer: notConnectedPerformer } , ( error ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				// User not listed in specific rights
				app.get( '/Blogs/5437f846c41d0e910ec9a5d8/Posts/5437f846c41d0e910e59a5d0' ,
					{ performer: unauthorizedPerformer } ,
					( error , document ) => {
						expect( error ).not.to.be.ok() ;
						expect( document.title ).to.be( "I can do that!" ) ;
						callback() ;
					}
				) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "More inheritance tests needed" ) ;
} ) ;



describe( "Indexes" , () => {

	it( "Test indexes" ) ;
} ) ;



describe( "Hooks" , () => {

	it( "Test init (app) hooks" ) ;
	it( "Test beforeCreate hooks" ) ;
	it( "Test afterCreate hooks" ) ;
	it( "Test beforeModify hooks" ) ;
	it( "Test afterModify hooks" ) ;
	it( "Test beforeDelete hooks" ) ;
	it( "Test afterDelete hooks" ) ;
} ) ;



describe( "Custom methods (POST to a METHOD)" , () => {

	it( "Custom root object method" , ( done ) => {

		var app , performer , blog , id ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/SUPA-METHOD' , {
					to: 'toto'
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					expect( response ).to.equal( { done: "something" , to: "toto" } ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/SUPA-METHOD' , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					expect( response ).to.equal( { done: "nothing" , cause: "this is a GET request" } ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "Custom collection method" , ( done ) => {

		var app , performer , blog , id ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Users/DO-SOMETHING' , {
					to: 'toto'
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					expect( response ).to.equal( { done: "something" , to: "toto" } ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Users/DO-SOMETHING' , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					expect( response ).to.equal( { done: "nothing" , cause: "this is a GET request" } ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "Custom object method" , ( done ) => {

		var app , performer , blog , userId ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Users' , {
					firstName: "Joe" ,
					lastName: "Doe" ,
					email: "joe.doe@gmail.com" ,
					password: "pw" ,
					publicAccess: "all"
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					userId = response.id ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Users/' + userId + '/CHANGE-FIRST-NAME' , {
					lastName: 'Toto'
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					expect( response.done ).to.be( 'nothing' ) ;
					expect( response.to.firstName ).to.be( 'Joe' ) ;
					expect( response.to.lastName ).to.be( 'Doe' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Users/' + userId + '/CHANGE-FIRST-NAME' , {
					firstName: 'Toto'
				} , null , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					expect( response.done ).to.be( 'something' ) ;
					expect( response.to.firstName ).to.be( 'Toto' ) ;
					expect( response.to.lastName ).to.be( 'Doe' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Users/' + userId + '/CHANGE-FIRST-NAME' , { performer: performer } , ( error , response ) => {
					expect( error ).not.to.be.ok() ;
					expect( response ).to.equal( { done: "nothing" , cause: "this is a GET request" } ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Users/' + userId , { performer: performer } , ( error , user ) => {
					expect( error ).not.to.be.ok() ;
					expect( user.firstName ).to.be( 'Toto' ) ;
					expect( user.lastName ).to.be( 'Doe' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;
} ) ;




describe( "Alter Schema" , () => {

	it( "altered schema should alter the SCHEMA method output" , ( done ) => {

		var app , performer , blog , post , blogId , postId ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				blog = app.root.children.blogs.collection.createDocument( {
					title: 'My wonderful life' ,
					description: 'This is a supa blog!' ,
					customSchema: {
						posts: {
							extraProperties: true ,
							properties: {
								custom: { type: 'string' }
							}
						}
					} ,
					publicAccess: 'all'
				} ) ;
				blogId = blog._id ;
				blog.$.save( callback ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/' + blogId + '/Posts/SCHEMA' , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					expect( object ).to.equal(
						tree.extend(
							{ deep: true } ,
							app.root.children.blogs.children.posts.schema ,
							{ properties: { custom: { type: 'string' } } }
						)
					) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "altered schema should alter POST" , ( done ) => {

		var app , performer , blog , post , blogId , postId ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				blog = app.root.children.blogs.collection.createDocument( {
					title: 'My wonderful life' ,
					description: 'This is a supa blog!' ,
					customSchema: {
						posts: {
							extraProperties: true ,
							properties: {
								custom: { type: 'string' }
							}
						}
					} ,
					publicAccess: 'all'
				} ) ;
				blogId = blog._id ;
				blog.$.save( callback ) ;
			} ,
			function( callback ) {
				app.post( '/Blogs/' + blogId + '/Posts/' , {
					title: 'My first post!' ,
					content: 'Blah blah blah.'
				} , null , { performer: performer } , ( error , rawDocument ) => {
					expect( error ).to.be.ok() ;
					expect( error.name ).to.be( 'ValidatorError' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Blogs/' + blogId + '/Posts/' , {
					title: 'My first post!' ,
					content: 'Blah blah blah.' ,
					custom: 12
				} , null , { performer: performer } , ( error , rawDocument ) => {
					expect( error ).to.be.ok() ;
					expect( error.name ).to.be( 'ValidatorError' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.post( '/Blogs/' + blogId + '/Posts/' , {
					title: 'My first post!' ,
					content: 'Blah blah blah.' ,
					custom: 'value'
				} , null , { performer: performer } , ( error , rawDocument ) => {
					expect( error ).not.to.be.ok() ;
					postId = rawDocument.id ;
					//console.log( 'ID:' , id ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/' + blogId + '/Posts/' + postId , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					//console.log( object ) ;
					expect( object.title ).to.be( 'My first post!' ) ;
					expect( object.content ).to.be( 'Blah blah blah.' ) ;
					expect( object.custom ).to.be( 'value' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "altered schema should alter PUT" , ( done ) => {

		var app , performer , blog , post , blogId , postId = '123456789612345678901234' ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				blog = app.root.children.blogs.collection.createDocument( {
					title: 'My wonderful life' ,
					description: 'This is a supa blog!' ,
					customSchema: {
						posts: {
							extraProperties: true ,
							properties: {
								custom: { type: 'string' }
							}
						}
					} ,
					publicAccess: 'all'
				} ) ;
				blogId = blog._id ;
				blog.$.save( callback ) ;
			} ,
			function( callback ) {
				app.put( '/Blogs/' + blogId + '/Posts/' + postId , {
					title: 'My first post!' ,
					content: 'Blah blah blah.'
				} , null , { performer: performer } , ( error , rawDocument ) => {
					expect( error ).to.be.ok() ;
					expect( error.name ).to.be( 'ValidatorError' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.put( '/Blogs/' + blogId + '/Posts/' + postId , {
					title: 'My first post!' ,
					content: 'Blah blah blah.' ,
					custom: 12
				} , null , { performer: performer } , ( error , rawDocument ) => {
					expect( error ).to.be.ok() ;
					expect( error.name ).to.be( 'ValidatorError' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.put( '/Blogs/' + blogId + '/Posts/' + postId , {
					title: 'My first post!' ,
					content: 'Blah blah blah.' ,
					custom: 'value'
				} , null , { performer: performer } , ( error , rawDocument ) => {
					expect( error ).not.to.be.ok() ;
					postId = rawDocument.id ;
					//console.log( 'ID:' , id ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/' + blogId + '/Posts/' + postId , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					//console.log( object ) ;
					expect( object.title ).to.be( 'My first post!' ) ;
					expect( object.content ).to.be( 'Blah blah blah.' ) ;
					expect( object.custom ).to.be( 'value' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "altered schema should alter PATCH" , ( done ) => {

		var app , performer , blog , post , blogId , postId ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				blog = app.root.children.blogs.collection.createDocument( {
					title: 'My wonderful life' ,
					description: 'This is a supa blog!' ,
					customSchema: {
						posts: {
							extraProperties: true ,
							properties: {
								custom: { type: 'string' }
							}
						}
					} ,
					publicAccess: 'all'
				} ) ;
				blogId = blog._id ;
				blog.$.save( callback ) ;
			} ,
			function( callback ) {
				app.post( '/Blogs/' + blogId + '/Posts/' , {
					title: 'My first post!' ,
					content: 'Blah blah blah.' ,
					custom: 'value'
				} , null , { performer: performer } , ( error , rawDocument ) => {
					expect( error ).not.to.be.ok() ;
					postId = rawDocument.id ;
					//console.log( 'ID:' , id ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/' + blogId + '/Posts/' + postId , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					//console.log( object ) ;
					expect( object.title ).to.be( 'My first post!' ) ;
					expect( object.content ).to.be( 'Blah blah blah.' ) ;
					expect( object.custom ).to.be( 'value' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.patch( '/Blogs/' + blogId + '/Posts/' + postId , {
					custom: 12
				} , null , { performer: performer } , ( error , rawDocument ) => {
					expect( error ).to.be.ok() ;
					expect( error.name ).to.be( 'ValidatorError' ) ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.patch( '/Blogs/' + blogId + '/Posts/' + postId , {
					custom: 'value2'
				} , null , { performer: performer } , ( error , rawDocument ) => {
					expect( error ).not.to.be.ok() ;
					callback() ;
				} ) ;
			} ,
			function( callback ) {
				app.get( '/Blogs/' + blogId + '/Posts/' + postId , { performer: performer } , ( error , object ) => {
					expect( error ).not.to.be.ok() ;
					//console.log( object ) ;
					expect( object.title ).to.be( 'My first post!' ) ;
					expect( object.content ).to.be( 'Blah blah blah.' ) ;
					expect( object.custom ).to.be( 'value2' ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;
} ) ;



describe( "Populate" , () => {

	it( "Test populate" ) ;
} ) ;



describe( "Tier level" , () => {

	it( "Test tier level" ) ;
} ) ;



describe( "Scheduler" , () => {

	it( "Test the scheduler" ) ;
} ) ;



describe( "Client error management" , () => {

	it( "Test client error management" ) ;
} ) ;



describe( "Misc" , () => {

	it( "Test of the test: test helper commonApp() should clean previously created items" , async () => {
		var { app , performer } = await commonApp() ;

		var response = await app.put( '/Blogs/5437f846c41d0e910ec9a5d8' ,
			{
				title: 'My wonderful life 2!!!' ,
				description: 'This is a supa blog! (x2)' ,
				publicAccess: 'all'
			} ,
			null ,
			{ performer: performer }
		) ;
		
		response = await app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: performer } ) ;
		expect( response.output.data ).to.partially.equal( {
			title: 'My wonderful life 2!!!' ,
			description: 'This is a supa blog! (x2)' ,
			parent: { id: '/' , collection: null }
		} ) ;
		
		// It should reset
		( { app , performer } = await commonApp() ) ;
		
		// Same ID than in the previous request
		await expect( () => app.get( '/Blogs/5437f846c41d0e910ec9a5d8' , { performer: performer } ) ).to.reject( ErrorStatus , { type: 'notFound', httpStatus: 404 } ) ;
	} ) ;

	it( "Shema's 'defaultPublicAccess'" , ( done ) => {

		var app , performer , blog , id ;

		async.series( [
			function( callback ) {
				commonApp( ( error , a , p ) => {
					app = a ;
					performer = p ;
					expect( app.collectionNodes.blogs.collection.documentSchema.properties.publicAccess.default )
						.to.equal( { traverse: 1 , read: 3 , create: 1 } ) ;
					expect( app.collectionNodes.comments.collection.documentSchema.properties.publicAccess.default )
						.to.equal( { read: 3 } ) ;
					callback() ;
				} ) ;
			}
		] )
			.exec( done ) ;
	} ) ;

	it( "Test CORS" ) ;

	it( "Test --buildIndexes" ) ;
	it( "Test --initDb <filepath>" ) ;
} ) ;

