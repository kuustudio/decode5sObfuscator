const fs            = require('fs');
const parser        = require("@babel/parser");
const traverse      = require("@babel/traverse").default;
const types         = require("@babel/types");
const generator     = require("@babel/generator").default;

//js混淆代码读取
process.argv.length > 2 ? encodeFile = process.argv[2]: encodeFile ="./encode.js";
process.argv.length > 3 ? decodeFile = process.argv[3]: decodeFile ="./decodeResult.js";

//将源代码解析为AST
let sourceCode = fs.readFileSync(encodeFile, {encoding: "utf-8"});
let ast    = parser.parse(sourceCode);



const callToLiteral = 
{
	AssignmentExpression(path)
	{
		let {node,scope} = path;
		let {left,operator,right} = node;
		let code = path.toString();
		if (!types.isIdentifier(left) || operator != "=" ||
		    !types.isCallExpression(right) || !code.includes("split"))
		{
			return;
		}
		
		let secondPath = path.getNextSibling();
		let thirdPath  = secondPath.getNextSibling();
		if (!secondPath.isCallExpression() ||
		    !thirdPath.isAssignmentExpression())
		{
			return;
		}
		let funcName = thirdPath.node.left.name;
		code += ',' + secondPath.toString();
		code += ',' + thirdPath.toString();
		
		eval(code);
		
		scope.traverse(scope.block, {
       "CallExpression"(path) 
       {
       	let {callee, arguments} = path.node;
       	if (!types.isIdentifier(callee,{name:funcName}))
       	{
       		return;
       	}
       	let calcValue = eval(path.toString());
       	console.log(path.toString(),"-->",calcValue);
       	path.replaceWith(types.valueToNode(calcValue));
       },
    });
    path.remove();
    secondPath.remove();
    thirdPath.remove();
    
	},
}

traverse(ast, callToLiteral);



const standardLoop = 
{
	"ForStatement|WhileStatement"({node})
	{
		if(!types.isBlockStatement(node.body))
    {
    	node.body = types.BlockStatement([node.body]);
    }
  },
}

traverse(ast, standardLoop);


const SimplifyIfStatement = {
	"IfStatement"(path)
	{
		const consequent = path.get("consequent");
    const alternate = path.get("alternate");
    const test = path.get("test");
    const evaluateTest = test.evaluateTruthy();
    
    if (!consequent.isBlockStatement())
    {
    	consequent.replaceWith(types.BlockStatement([consequent.node]));
    }
		if (alternate.node !== null && !alternate.isBlockStatement())
		{
			alternate.replaceWith(types.BlockStatement([alternate.node]));
		}
		
		if (consequent.node.body.length == 0)
		{
			if (alternate.node == null)
			{
				path.replaceWith(test.node);
			}
			else
			{
				consequent.replaceWith(alternate.node);
				alternate.remove();
				path.node.alternate = null;
        test.replaceWith(types.unaryExpression("!", test.node, true));
			}
		}

		if (alternate.isBlockStatement() && alternate.node.body.length == 0)
		{
			alternate.remove();
			path.node.alternate = null;
		}
		
		if (evaluateTest === true)
		{
			path.replaceWithMultiple(consequent.node.body);
		} 
		else if (evaluateTest === false)
		{ 
			alternate.node === null? path.remove():path.replaceWithMultiple(alternate.node.body);
		}
  },
}

traverse(ast, SimplifyIfStatement);




const resolveSequenceForLogicalExpression = 
{
	IfStatement(path)
	{
		let {test} = path.node;
		if (!types.isLogicalExpression(test))
		{
			return;
		}
		let {left,operator,right} = test;
		if (types.isSequenceExpression(left))
		{
			let {expressions} = left;
			let lastNode = expressions.pop();
			for (let expression of expressions)
			{
				path.insertBefore(types.ExpressionStatement(expression=expression));
			}
			path.node.test.left = lastNode;
		}
		
		if (operator == "&&" && types.isSequenceExpression(right))
		{
			let {expressions} = right;
			let lastNode = expressions.pop();
			let ifBody = [];
			for (let expression of expressions)
			{
				ifBody.push(types.ExpressionStatement(expression=expression));
			}
			path.node.test.right = lastNode;
			let ifNode = types.IfStatement(path.node.test.left,types.BlockStatement(ifBody),null);
			path.insertBefore(ifNode);
		}
	}
}
traverse(ast, resolveSequenceForLogicalExpression);






const restoreSequenceForInit = 
{
	"SequenceExpression"(path)
	{
		let {scope,node,parentPath} = path;
		if (!parentPath.isIfStatement({test:node}) && !parentPath.isAssignmentExpression({right:node}) &&
		    !parentPath.isForStatement({init:node}) )
		{
			return;
		}
		let {expressions} = node;
		let lastNode = expressions.pop();
		for (let expression of expressions)
		{
			parentPath.insertBefore(types.ExpressionStatement(expression=expression));
		}
		
		path.replaceWith(lastNode);
		scope.crawl();
	}
}


traverse(ast, restoreSequenceForInit);

const resolveSequence = 
{
	SequenceExpression(path)
	{
		let {scope,parentPath,node} = path;
		let expressions = node.expressions;
		if (parentPath.isReturnStatement({"argument":node}))
		{
			let lastExpression = expressions.pop();
			for (let expression of expressions)
			{
				parentPath.insertBefore(types.ExpressionStatement(expression=expression));
			}
			
			path.replaceInline(lastExpression);
		}
		else if (parentPath.isExpressionStatement({"expression":node}))
		{
			let body = [];
			expressions.forEach(express=>{
      body.push(types.ExpressionStatement(express));
    });
   path.replaceInline(body);
		}
		else
		{
			return;
		}
		
		scope.crawl();
	}
}

traverse(ast, resolveSequence);



const constantFold = 
{
	  "BinaryExpression|UnaryExpression"(path)
    {
    	if(path.isUnaryExpression({operator:"-"}) || 
    	   path.isUnaryExpression({operator:"void"}))
    	{
    		return;
    	}
    	const {confident,value} = path.evaluate();
    	if (!confident || value == "Infinity") return;
    	if (typeof value == 'number' &&  isNaN(value)) return;
    	path.replaceWith(types.valueToNode(value));
    },
}

traverse(ast, constantFold);



const keyToLiteral = {
	MemberExpression:
	{
		exit({node})
		{
			const prop = node.property;
			if (!node.computed && types.isIdentifier(prop))
			{
				node.property = types.StringLiteral(prop.name);
				node.computed = true;
			}
    }
  },	
  ObjectProperty: 
  {
		exit({node})
		{
			const key = node.key;
			if (!node.computed && types.isIdentifier(key))
			{
				node.key = types.StringLiteral(key.name);
			}
		}
	},  
}

traverse(ast, keyToLiteral);

const createObjectOfB = 
{
	AssignmentExpression(path)
	{
		let {scope,parentPath,node} = path;
		if (!parentPath.isExpressionStatement()) return;
		let {left,operator,right} = node;
		if (!types.isMemberExpression(left) || operator != "=")
		{
			return;
		}
		
		let {object,property} = left;
		
		if (!types.isIdentifier(object) || !types.isStringLiteral(property) ||
		   property.value.length != 5 )
		{
			return;
		}
		
		let prevPath = parentPath.getPrevSibling();
		
		if (prevPath.node != null)
		{
			return;
		}
		
		let newAssginNode  = types.AssignmentExpression(operator,object,types.ObjectExpression([]));
		let expressionNode = types.ExpressionStatement(expression = newAssginNode);
		path.insertBefore(expressionNode);
		scope.crawl();
	}
}

traverse(ast, createObjectOfB);




const preDecodeObject = {
	AssignmentExpression({node,parentPath,scope})
	{
		const {left,right,operator} = node;
		if (!types.isIdentifier(left) || operator != "=" || 
		    !types.isObjectExpression(right)) return;
		let name = left.name;

		let properties = right.properties;
		let allNextSiblings = parentPath.getAllNextSiblings();
		for (let nextSibling of allNextSiblings)
		{
			if (!nextSibling.isExpressionStatement())  break;
			
			let expression = nextSibling.get('expression');
			if (!expression.isAssignmentExpression({operator:"="})) break;

			let {left,right} = expression.node;
			if (!types.isMemberExpression(left)) break;
			
			let {object,property} = left;
			if (!types.isIdentifier(object,{name:name}) ||
			    !types.isStringLiteral(property)) 
		  {
		  	break;
		  }
		  
			properties.push(types.ObjectProperty(property,right));
			nextSibling.remove();
		}	
		scope.crawl();	
	},
}

traverse(ast, preDecodeObject);









function savePropertiesToObject(properties,newMap)
{
	for (const property of properties)
	{
		let propKey   = property.key.value;
		let propValue = property.value;
		if (types.isLiteral(propValue))
		{
			newMap.set(propKey,propValue.value);
		}
		else if (types.isFunctionExpression(propValue))
		{
			let retState = propValue.body.body;
			if (retState.length == 1 && types.isReturnStatement(retState[0]))
			{
				let argument = retState[0].argument;
				if (types.isCallExpression(argument))
				{
					newMap.set(propKey,"Call");
				}
				else if (types.isBinaryExpression(argument) || 
							   types.isLogicalExpression(argument))
				{
					newMap.set(propKey,argument.operator);
				}
			}
		}
		else
		{
			break;
		}
	}
}

function replaceReferNode(newMap,referencePaths,scope)
{
	for (const referPath of referencePaths)
	{
		let {node,parent,parentPath} = referPath;
		let ancestorPath = parentPath.parentPath;
		if (!parentPath.isMemberExpression({object:node})) 
		{
			continue;
		}
		let {property} = parent;
		let propKey = property.value;
		let propValue = newMap.get(propKey);
		if (!propValue) 
		{
			continue;
		}

		
		if (ancestorPath.isCallExpression({callee:parent}))
		{
			let {arguments} = ancestorPath.node;
			switch (propValue) {
					case "Call":
						 ancestorPath.replaceWith(types.CallExpression(arguments[0], arguments.slice(1)));
						 break;
					case "||":
					case "&&":
						 ancestorPath.replaceWith(types.LogicalExpression(propValue, arguments[0], arguments[1]));
						 break;
					default:
						 ancestorPath.replaceWith(types.BinaryExpression(propValue, arguments[0], arguments[1]));
						 break; 
			}
		}
		else
		{
			parentPath.replaceWith(types.valueToNode(propValue));
		}
		
		scope.crawl();
	}	
}



const decodeObject = {
	AssignmentExpression(path)
	{
		let {node,scope,parentPath} = path;
		const {left,right,operator} = node;
		
		if (!types.isIdentifier(left) || operator != "=" || 
		    !types.isObjectExpression(right)) return;
		
		let name = left.name;

		let binding =  scope.getBinding(name);
		
		let {constantViolations,referencePaths} = binding;


		let properties = right.properties;
		if (properties.length == 0) return;
		

		let newMap = new Map();
		savePropertiesToObject(properties,newMap); 
		if (newMap.size != properties.length) return;
		
		let nextSibling = parentPath.getNextSibling();
		if (!nextSibling.isExpressionStatement()) return;
		let {expression} = nextSibling.node;
		
		if (types.isAssignmentExpression(expression))
		{
			const {left,right,operator} = expression;
			let binding =  scope.getBinding(left.name);
			
			let {constantViolations,referencePaths} = binding;
			replaceReferNode(newMap,referencePaths,scope);
			parentPath.remove();
			nextSibling.remove();
			
		}
		newMap.clear();
		scope.crawl();
	},
}

traverse(ast, decodeObject);




const decodeControlFlowFor5s = {
	"ForStatement"(path)
	{
		const {node,scope} = path;
		let {init,test,update,body} = node;
		if (!types.isAssignmentExpression(init) || !types.isBooleanLiteral(test) || update != null)
		{
			return;
		}
		
		let prevPath = path.getPrevSibling();
		if (!prevPath.isExpressionStatement() || !types.isAssignmentExpression(prevPath.node.expression))
		{
			return;
		}
		
		
		let disPatchArray = prevPath.node.expression.right.callee.object.value.split("|");
		
		let switchNode = body.body[0];
		let {cases} = switchNode;
		
		let retBody = [];
		disPatchArray.forEach(index =>
		{
			let caseBody = cases[index].consequent;
			if (types.isContinueStatement(caseBody[caseBody.length-1]))
			{
				caseBody.pop();
			}
			retBody = retBody.concat(caseBody);
		})
		
		path.replaceWithMultiple(retBody);
		prevPath.remove();
		scope.crawl();
	},
}

traverse(ast, decodeControlFlowFor5s);


const removeDeadCode = {
 "IfStatement|ConditionalExpression"(path)
 {
 let {consequent,alternate} = path.node;
 let testPath = path.get('test');
 const evaluateTest = testPath.evaluateTruthy();
 if (evaluateTest === true)
 {
  if (types.isBlockStatement(consequent))
  {
  consequent = consequent.body;
  }
  path.replaceWithMultiple(consequent);
 }
 else if (evaluateTest === false)
 {
  if (alternate != null)
  {
  if (types.isBlockStatement(alternate))
   {
   alternate = alternate.body;
   }
  path.replaceWithMultiple(alternate);
  }
  else
  {
  path.remove();
  }
 }   
 },
 EmptyStatement(path)
 {
  path.remove();
 },  
 "VariableDeclarator"(path)
 {
 let {node,scope,parentPath} = path;
 let binding = scope.getBinding(node.id.name); 
 if (binding && !binding.referenced && binding.constant)
 {//没有被引用，也没有被改变
  console.log(path.parentPath.toString())
  path.remove();
 }
 },
 "ReturnStatement"(path)
 {
 let AllNextSiblings = path.getAllNextSiblings();
 for (let nextSibling of AllNextSiblings)
 {
  if (nextSibling.isBreakStatement())
  {
  continue;
  }
  nextSibling.remove();
 }
 },
 "BreakStatement|ContinueStatement"(path)
 {
 let AllNextSiblings = path.getAllNextSiblings();
 for (let nextSibling of AllNextSiblings)
 {
  nextSibling.remove();
 }
 } 
}

traverse(ast,removeDeadCode);

const LogicalToIfStatement = 
{
	LogicalExpression(path)
	{
		let {node,parentPath} = path;
		if (!parentPath.isExpressionStatement())
		{
			return;
		}
		let {left,operator,right} = node;
		
		let blockNode = types.BlockStatement([]);
		let newNode = types.BlockStatement([types.ExpressionStatement(right)])
		
		let ifNode = undefined;
		
		if (operator == "||")
		{
			ifNode = types.IfStatement(left,blockNode,newNode);
		}
		else if (operator == "&&")
		{
			ifNode = types.IfStatement(left,newNode,null);
		}
		else
		{
			return;
		}
		
		parentPath.replaceWith(ifNode);
	},

}

traverse(ast, LogicalToIfStatement);

traverse(ast, resolveSequence);



let {code} = generator(ast);

fs.writeFile(decodeFile, code, (err) => {});