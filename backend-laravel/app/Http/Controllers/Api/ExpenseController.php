<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Expense;
use Illuminate\Http\Request;

class ExpenseController extends Controller
{
    public function index()
    {
        return response()->json(Expense::with('restaurant')->get());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'integer'],
            'name' => ['required', 'string', 'max:255'],
            'amount' => ['required', 'numeric', 'min:0'],
            'category' => ['nullable', 'string', 'max:100'],
            'date' => ['nullable', 'date'],
            'description' => ['nullable', 'string'],
        ]);
        $validated = $this->assignRestaurant($validated, $request);

        $expense = Expense::create($validated);

        return response()->json($expense, 201);
    }

    public function show(Expense $expense)
    {
        return response()->json($expense->load('restaurant'));
    }

    public function update(Request $request, Expense $expense)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'exists:restaurants,id'],
            'name' => ['sometimes', 'string', 'max:255'],
            'amount' => ['sometimes', 'numeric', 'min:0'],
            'category' => ['nullable', 'string', 'max:100'],
            'date' => ['nullable', 'date'],
            'description' => ['nullable', 'string'],
        ]);

        $expense->update($validated);

        return response()->json($expense);
    }

    public function destroy(Expense $expense)
    {
        $expense->delete();

        return response()->json(null, 204);
    }
}
